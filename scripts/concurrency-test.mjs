/**
 * Prueba de concurrencia (Race Condition) del Inventory Service - Grupo 7.
 *
 * Dispara N reservas EN PARALELO por la ultima unidad del mismo producto.
 * Resultado esperado: exactamente 1 reserva con exito (201) y N-1 rechazos (422).
 * Si hubiera 2+ exitos => sobreventa => el mutex no protege la concurrencia.
 *
 * Uso:
 *   node scripts/concurrency-test.mjs                 # contra Render (default)
 *   node scripts/concurrency-test.mjs http://localhost:3006 20   # local, 20 peticiones
 */

const BASE_URL = process.argv[2] || "https://inventario-g7.onrender.com";
const N = Number(process.argv[3] || 10);
const PRODUCT_ID = "660e8400-e29b-41d4-a716-446655440111";

const uuid = () => crypto.randomUUID();

async function resetStockToOne() {
  // SET deja availableStock = 1 y reservedStock = 0 (estado limpio).
  const res = await fetch(`${BASE_URL}/inventory/${PRODUCT_ID}/stock`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Consumer": "concurrency-test",
      "X-Correlation-Id": uuid(),
      "Idempotency-Key": uuid()
    },
    body: JSON.stringify({ quantity: 1, operation: "SET" })
  });
  if (!res.ok) throw new Error(`No se pudo resetear el stock: HTTP ${res.status}`);
  const body = await res.json();
  console.log(`Stock reiniciado a 1. availableStock=${body.availableStock}\n`);
}

function reserveLastUnit(i) {
  return fetch(`${BASE_URL}/inventory/reserve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Consumer": "order-service",
      "X-Correlation-Id": uuid(),
      "Idempotency-Key": uuid()
    },
    body: JSON.stringify({
      orderId: `ORD-CONC-${i}-${Date.now()}`,
      items: [{ productId: PRODUCT_ID, quantity: 1 }]
    })
  }).then(async (res) => ({ i, status: res.status, body: await res.json().catch(() => ({})) }));
}

async function main() {
  console.log(`=== Prueba de concurrencia ===`);
  console.log(`Base URL : ${BASE_URL}`);
  console.log(`Producto : ${PRODUCT_ID}`);
  console.log(`Peticiones paralelas: ${N}\n`);

  await resetStockToOne();

  // Disparo simultaneo: todas las promesas se lanzan antes de esperar ninguna.
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) => reserveLastUnit(i))
  );

  const ok = results.filter((r) => r.status === 201);
  const rejected = results.filter((r) => r.status === 422);
  const others = results.filter((r) => r.status !== 201 && r.status !== 422);

  console.log("Resultados por peticion:");
  for (const r of results.sort((a, b) => a.status - b.status)) {
    console.log(`  #${r.i}  HTTP ${r.status}  ${r.body.code || r.body.status || "RESERVED"}`);
  }

  console.log(`\nResumen: ${ok.length} exito(201) | ${rejected.length} rechazo(422) | ${others.length} otros`);

  const passed = ok.length === 1 && others.length === 0;
  if (passed) {
    console.log("\n✅ PASA: exactamente 1 reserva gano la ultima unidad. Sin sobreventa.");
    process.exit(0);
  } else {
    console.log("\n❌ FALLA: se esperaba exactamente 1 exito y 0 'otros'. Revisar concurrencia.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error ejecutando la prueba:", err.message);
  process.exit(1);
});
