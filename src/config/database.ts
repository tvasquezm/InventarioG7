// ======================================================
// Database - Conexion a Postgres (Supabase)
// Grupo 7 - Inventory Service - Fase 3 (E3 Cloud)
// ======================================================

import { Pool, PoolClient } from "pg";

// Ejecutor de queries: el pool (queries sueltas) o un cliente (dentro de transaccion).
export type Db = Pool | PoolClient;

// El connection string de Supabase se inyecta por variable de entorno.
// Local: en el archivo .env (ver .env.example). Render: en el dashboard.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL no esta definida. Copia .env.example a .env y pega el connection string de Supabase."
  );
}

// Schema dedicado del servicio (database-per-service).
// La BD es propia del grupo: el schema de G7 es 'inventario' y vive solo
// en nuestro proyecto Supabase. Se usa para CALIFICAR las tablas en las
// queries (inventario.tabla), asi no dependemos del search_path (que el
// pooler de Supabase puede ignorar).
export const DB_SCHEMA = process.env.DB_SCHEMA || "inventario";

export const pool = new Pool({
  connectionString,
  // Supabase exige TLS.
  ssl: { rejectUnauthorized: false },
  // Pool acotado: Render free + plan free de Supabase tienen pocas conexiones.
  max: 5,
  // Cada conexion fisica apunta al schema del servicio desde el arranque,
  // asi las queries no necesitan calificar el schema a mano.
  options: `-c search_path=${DB_SCHEMA},public`
});

pool.on("error", (err) => {
  console.error("Error inesperado en el pool de Postgres:", err);
});

/**
 * Atajo para queries sueltas (sin transaccion).
 */
export function query<T extends import("pg").QueryResultRow = any>(
  text: string,
  params?: unknown[]
) {
  return pool.query<T>(text, params);
}

/**
 * Ejecuta una funcion dentro de una transaccion (BEGIN/COMMIT/ROLLBACK).
 * Se usa para la reserva todo-o-nada (control de concurrencia real).
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Verifica que la BD responde (se llama al arrancar el server).
 */
export async function pingDatabase(): Promise<void> {
  const result = await pool.query("SELECT 1 AS ok");
  if (result.rows[0]?.ok !== 1) {
    throw new Error("La base de datos no respondio al ping.");
  }
}
