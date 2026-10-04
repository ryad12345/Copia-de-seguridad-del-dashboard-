// =====================================================================
// MOZONA TPV — printer.rs: driver de impresora térmica USB y Serie
// =====================================================================
// Acceso directo al puerto desde Rust. El frontend envía bytes ESC/POS
// (puede usar EscposBuilder.ts tal cual) y el backend los escribe al
// dispositivo físico.
//
// Transportes soportados:
//   • USB  : rusb (libusb). Para impresoras 80mm USB que se identifican
//            como device class 0x07 (printer) o vendor IDs conocidos.
//   • SERIE: serialport. Para impresoras conectadas por adaptador
//            USB-Serial (CH340, FTDI, etc.) que aparecen como /dev/tty*,
//            COM* o /dev/cu.*.
//   • RED  : (placeholder) impresora remota por TCP/IP (puerto 9100).
//
// Mantenemos UNA conexión activa a la vez (parking_lot::Mutex).
// =====================================================================

use std::io::Write;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use rusb::{Context, Device, DeviceDescriptor, Direction, TransferType, UsbContext};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------------
// Vendor IDs típicos de impresoras térmicas ESC/POS
// ---------------------------------------------------------------------
pub const KNOWN_VENDOR_IDS: &[(u16, &str)] = &[
    (0x04b8, "Epson"),
    (0x0416, "Winbond (Xprinter)"),
    (0x0fe6, "ICS Advent"),
    (0x1a86, "QinHeng (CH340 clones)"),
    (0x1d50, "OpenMoko (compatibles)"),
    (0x04e8, "Samsung"),
    (0x067b, "Prolific"),
    (0x0519, "Seiko Epson"),
    (0x0dd4, "Custom Engineering"),
];

// ---------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransportKind {
    Usb,
    Serial,
    Network,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrinterInfo {
    pub kind:         TransportKind,
    pub device_name:  String,
    pub manufacturer: String,
    pub product:      Option<String>,
    pub serial:       Option<String>,
    pub bus:          Option<u8>,
    pub address:      Option<u8>,
    pub port:         Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectedPrinter {
    pub kind:       TransportKind,
    pub name:       String,
    pub identifier: String,   // texto para conectar después
    pub info:       String,
}

// ---------------------------------------------------------------------
// Estado de conexión activa
// ---------------------------------------------------------------------

enum ActivePrinter {
    Usb {
        handle:     Arc<Mutex<rusb::DeviceHandle<Context>>>,
        endpoint:   u8,
        iface:      u8,
    },
    Serial {
        port: Arc<Mutex<Box<dyn serialport::SerialPort + Send>>>,
    },
    Network {
        stream: Arc<Mutex<std::net::TcpStream>>,
    },
}

pub struct PrinterState {
    active: Mutex<Option<ActivePrinter>>,
}

impl PrinterState {
    pub fn new() -> Self {
        Self { active: Mutex::new(None) }
    }

    pub fn is_connected(&self) -> bool {
        self.active.lock().is_some()
    }

    pub fn info(&self) -> Option<PrinterInfo> {
        self.active.lock().as_ref().map(|p| match p {
            ActivePrinter::Usb { handle, .. } => {
                // Re-leemos device info del handle
                let dev = handle.lock().device();
                let desc = dev.device_descriptor().ok();
                PrinterInfo {
                    kind: TransportKind::Usb,
                    device_name: desc.as_ref().and_then(|d| read_string(dev, d.product_string_index())).unwrap_or_default(),
                    manufacturer: desc.as_ref().and_then(|d| read_string(dev, d.manufacturer_string_index())).unwrap_or_default(),
                    product: desc.as_ref().map(|d| format!("{:04x}:{:04x}", d.vendor_id(), d.product_id())),
                    serial: desc.as_ref().and_then(|d| read_string(dev, d.serial_number_string_index())),
                    bus: dev.bus_number().ok(),
                    address: dev.address().ok(),
                    port: None,
                }
            }
            ActivePrinter::Serial { port } => {
                let p = port.lock();
                let name = p.name().unwrap_or_else(|_| "serial".into());
                drop(p);
                PrinterInfo {
                    kind: TransportKind::Serial,
                    device_name: name.clone(),
                    manufacturer: "Serial port".into(),
                    product: None,
                    serial: None,
                    bus: None,
                    address: None,
                    port: Some(name),
                }
            }
            ActivePrinter::Network { .. } => PrinterInfo {
                kind: TransportKind::Network,
                device_name: "Network".into(),
                manufacturer: "TCP/IP".into(),
                product: None,
                serial: None,
                bus: None,
                address: None,
                port: Some("9100".into()),
            },
        })
    }

    /// Envía bytes ESC/POS a la impresora activa.
    pub fn write(&self, bytes: &[u8]) -> AppResult<usize> {
        let guard = self.active.lock();
        let printer = guard.as_ref().ok_or_else(|| AppError::Validation("No hay impresora conectada".into()))?;
        match printer {
            ActivePrinter::Usb { handle, endpoint, iface: _ } => {
                let h = handle.lock();
                let written = h.write_bulk(*endpoint, bytes, Duration::from_secs(5))?;
                Ok(written)
            }
            ActivePrinter::Serial { port } => {
                let mut p = port.lock();
                p.write_all(bytes)?;
                p.flush()?;
                Ok(bytes.len())
            }
            ActivePrinter::Network { stream } => {
                let mut s = stream.lock();
                s.write_all(bytes)?;
                s.flush()?;
                Ok(bytes.len())
            }
        }
    }

    pub fn disconnect(&self) {
        *self.active.lock() = None;
    }

    /// Conecta por USB al primer dispositivo de la lista de candidatos.
    pub fn connect_usb(&self, vendor: Option<u16>, product: Option<u16>) -> AppResult<PrinterInfo> {
        let context = Context::new()?;
        let devices = context.devices()?;

        let mut chosen: Option<(Device<Context>, DeviceDescriptor)> = None;
        for dev in devices.iter() {
            let desc = dev.device_descriptor()?;
            let v = desc.vendor_id();
            let p = desc.product_id();

            // Filtro: vendor conocido y (opcionalmente) product concreto
            if KNOWN_VENDOR_IDS.iter().any(|(vid, _)| *vid == v) || vendor == Some(v) {
                if let Some(target_p) = product {
                    if p != target_p { continue; }
                }
                chosen = Some((dev, desc));
                break;
            }
        }

        let (device, desc) = chosen.ok_or_else(|| {
            AppError::NotFound("No se encontró ninguna impresora USB compatible".into())
        })?;

        // Localizar endpoint bulk OUT en la primera interfaz
        let config = device.active_config_descriptor()?;
        let mut endpoint_out: Option<u8> = None;
        let mut iface_num: u8 = 0;
        'outer: for iface in &config.interfaces {
            for alt in &iface.descriptors {
                for ep in &alt.endpoint_descriptors {
                    if ep.transfer_type() == TransferType::Bulk
                        && ep.direction() == Direction::Out
                    {
                        endpoint_out = Some(ep.address());
                        iface_num    = iface.interface_number();
                        break 'outer;
                    }
                }
            }
        }
        let endpoint = endpoint_out.ok_or_else(|| {
            AppError::NotFound("La impresora no expone endpoint bulk OUT".into())
        })?;

        let mut handle = device.open()?;
        // En Linux/macOS puede hacer falta detach kernel driver
        if handle.kernel_driver_active(iface_num).unwrap_or(false) {
            handle.detach_kernel_driver(iface_num).ok();
        }
        handle.claim_interface(iface_num)?;

        let info = PrinterInfo {
            kind: TransportKind::Usb,
            device_name: read_string(&device, desc.product_string_index()).unwrap_or_default(),
            manufacturer: read_string(&device, desc.manufacturer_string_index()).unwrap_or_default(),
            product: Some(format!("{:04x}:{:04x}", desc.vendor_id(), desc.product_id())),
            serial: read_string(&device, desc.serial_number_string_index()),
            bus: device.bus_number().ok(),
            address: device.address().ok(),
            port: None,
        };

        *self.active.lock() = Some(ActivePrinter::Usb {
            handle:   Arc::new(Mutex::new(handle)),
            endpoint,
            iface:    iface_num,
        });
        Ok(info)
    }

    /// Conecta a un puerto serie.
    pub fn connect_serial(&self, port: &str, baud: u32) -> AppResult<PrinterInfo> {
        let p = serialport::new(port, baud)
            .timeout(Duration::from_millis(1000))
            .data_bits(serialport::DataBits::Eight)
            .parity(serialport::Parity::None)
            .stop_bits(serialport::StopBits::One)
            .flow_control(serialport::FlowControl::None)
            .open()?;

        *self.active.lock() = Some(ActivePrinter::Serial {
            port: Arc::new(Mutex::new(p)),
        });

        Ok(PrinterInfo {
            kind: TransportKind::Serial,
            device_name: port.into(),
            manufacturer: "Serial port".into(),
            product: None,
            serial: None,
            bus: None,
            address: None,
            port: Some(port.into()),
        })
    }

    /// Conecta a una impresora de red (puerto TCP, típicamente 9100).
    pub fn connect_network(&self, host: &str, port: u16) -> AppResult<PrinterInfo> {
        use std::net::TcpStream;
        let stream = TcpStream::connect((host, port))?;
        stream.set_nodelay(true)?;

        *self.active.lock() = Some(ActivePrinter::Network {
            stream: Arc::new(Mutex::new(stream)),
        });

        Ok(PrinterInfo {
            kind: TransportKind::Network,
            device_name: format!("{}:{}", host, port),
            manufacturer: "TCP/IP".into(),
            product: None,
            serial: None,
            bus: None,
            address: None,
            port: Some(port.to_string()),
        })
    }
}

// ---------------------------------------------------------------------
// Detección
// ---------------------------------------------------------------------

/// Lista todos los dispositivos USB que parezcan impresoras térmicas.
pub fn list_usb_printers() -> AppResult<Vec<DetectedPrinter>> {
    let context = Context::new()?;
    let devices = context.devices()?;

    let mut out = Vec::new();
    for dev in devices.iter() {
        let desc = dev.device_descriptor()?;
        let v = desc.vendor_id();
        let p = desc.product_id();
        let is_printer_class = desc.class_code() == 0x07;       // USB Printer class
        let is_known = KNOWN_VENDOR_IDS.iter().any(|(vid, _)| *vid == v);

        if !(is_printer_class || is_known) { continue; }

        let name = read_string(&dev, desc.product_string_index())
            .unwrap_or_else(|| format!("{:04x}:{:04x}", v, p));
        let manufacturer = read_string(&dev, desc.manufacturer_string_index())
            .unwrap_or_else(|| "Desconocido".into());
        let bus = dev.bus_number().ok();
        let addr = dev.address().ok();

        out.push(DetectedPrinter {
            kind: TransportKind::Usb,
            name,
            identifier: format!("usb:{:04x}:{:04x}", v, p),
            info: format!("{} ({:04x}:{:04x}) bus={:?} addr={:?}", manufacturer, v, p, bus, addr),
        });
    }
    Ok(out)
}

/// Lista los puertos serie disponibles en el sistema.
pub fn list_serial_ports() -> AppResult<Vec<DetectedPrinter>> {
    let ports = serialport::available_ports().map_err(AppError::Serial)?;
    let out = ports.into_iter().map(|p| {
        let name = p.port_name.clone();
        DetectedPrinter {
            kind: TransportKind::Serial,
            name: name.clone(),
            identifier: format!("serial:{}", name),
            info: match p.port_type {
                serialport::SerialPortType::UsbPort      => "USB-Serial".to_string(),
                serialport::SerialPortType::BluetoothPort => "Bluetooth".to_string(),
                serialport::SerialPortType::PciPort      => "PCI".to_string(),
                serialport::SerialPortType::Unknown      => "Desconocido".to_string(),
            },
        }
    }).collect();
    Ok(out)
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

fn read_string<T: UsbContext>(dev: &Device<T>, index: Option<u8>) -> Option<String> {
    let idx = index?;
    dev.open().ok()
        .and_then(|mut h| h.read_string_descriptor_ascii(idx).ok())
}
