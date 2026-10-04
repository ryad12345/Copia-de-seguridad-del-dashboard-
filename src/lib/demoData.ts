// =====================================================================
// MOZONA TPV — demoData.ts (v4.0.7-demo-data)
// =====================================================================
// Datos demo para cuando Supabase Auth falla (ANON KEY incorrecta o
// backend caido). El cliente VIP ve algo coherente mientras tanto.
// =====================================================================

import type { Category, Product, RestaurantTable, Restaurant } from "./types";

export const DEMO_RESTAURANT: Restaurant = {
    id: "demo-restaurant",
    slug: "el-rincon-de-casablanca",
    business_name: "El Rincón de Casablanca",
    cif_nif: "B12345678",
    address: "Calle Gran Vía 123, Madrid",
    phone: "+34 644 16 51 53",
    primary_color: "#7c3aed",
    ticket_footer_msg: "¡Gracias por su visita!",
    created_at: new Date().toISOString(),
};

export const DEMO_CATEGORIES: Category[] = [
    { id: "cat-bebidas", name: "Bebidas", sort_order: 1, restaurant_id: "demo-restaurant" },
    { id: "cat-cafes", name: "Cafés", sort_order: 2, restaurant_id: "demo-restaurant" },
    { id: "cat-tapas", name: "Tapas", sort_order: 3, restaurant_id: "demo-restaurant" },
    { id: "cat-postres", name: "Postres", sort_order: 4, restaurant_id: "demo-restaurant" },
    { id: "cat-desayunos", name: "Desayunos", sort_order: 5, restaurant_id: "demo-restaurant" },
];

export const DEMO_PRODUCTS: Product[] = [
    { id: "p1", name: "Café solo", price: 1.5, category_id: "cat-cafes", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p2", name: "Café con leche", price: 1.8, category_id: "cat-cafes", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p3", name: "Cortado", price: 1.6, category_id: "cat-cafes", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p4", name: "Cappuccino", price: 2.5, category_id: "cat-cafes", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p5", name: "Tostada con tomate", price: 2.8, category_id: "cat-desayunos", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p6", name: "Tostada con jamón", price: 4.5, category_id: "cat-desayunos", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p7", name: "Croissant", price: 2.2, category_id: "cat-desayunos", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p8", name: "Cerveza Mahou 330ml", price: 2.5, category_id: "cat-bebidas", tax_rate: 21, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p9", name: "Agua mineral", price: 1.5, category_id: "cat-bebidas", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p10", name: "Refresco de cola", price: 2.0, category_id: "cat-bebidas", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p11", name: "Zumo de naranja", price: 2.8, category_id: "cat-bebidas", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p12", name: "Patatas bravas", price: 4.5, category_id: "cat-tapas", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p13", name: "Croquetas de jamón", price: 5.0, category_id: "cat-tapas", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p14", name: "Tortilla española", price: 4.0, category_id: "cat-tapas", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p15", name: "Pan con tomate", price: 3.5, category_id: "cat-tapas", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p16", name: "Brownie chocolate", price: 3.5, category_id: "cat-postres", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p17", name: "Tarta de queso", price: 4.0, category_id: "cat-postres", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
    { id: "p18", name: "Helado 2 bolas", price: 3.0, category_id: "cat-postres", tax_rate: 10, is_available: true, restaurant_id: "demo-restaurant", image_url: null, description: null },
];

export const DEMO_TABLES: RestaurantTable[] = [
    { id: "t1", table_number: "Mesa 1", restaurant_id: "demo-restaurant", zone_id: null, zone: "Salón", status: "FREE" },
    { id: "t2", table_number: "Mesa 2", restaurant_id: "demo-restaurant", zone_id: null, zone: "Salón", status: "FREE" },
    { id: "t3", table_number: "Mesa 3", restaurant_id: "demo-restaurant", zone_id: null, zone: "Salón", status: "OCCUPIED" },
    { id: "t4", table_number: "Mesa 4", restaurant_id: "demo-restaurant", zone_id: null, zone: "Salón", status: "FREE" },
    { id: "t5", table_number: "Mesa 5", restaurant_id: "demo-restaurant", zone_id: null, zone: "Salón", status: "FREE" },
    { id: "t6", table_number: "Mesa 6", restaurant_id: "demo-restaurant", zone_id: null, zone: "Terraza", status: "OCCUPIED" },
    { id: "t7", table_number: "Mesa 7", restaurant_id: "demo-restaurant", zone_id: null, zone: "Terraza", status: "FREE" },
    { id: "t8", table_number: "Mesa 8", restaurant_id: "demo-restaurant", zone_id: null, zone: "Terraza", status: "FREE" },
    { id: "t9", table_number: "Barra 1", restaurant_id: "demo-restaurant", zone_id: null, zone: "Barra", status: "FREE" },
    { id: "t10", table_number: "Barra 2", restaurant_id: "demo-restaurant", zone_id: null, zone: "Barra", status: "FREE" },
];
