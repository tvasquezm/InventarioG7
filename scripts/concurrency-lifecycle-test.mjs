/**
 * Pruebas de concurrencia del CICLO DE VIDA de la reserva - Grupo 7 (E4).
 *
 * Complementa concurrency-test.mjs (que cubre la ultima unidad) con las
 * carreras del resto del ciclo:
 *
 *  A. Doble reserva del mismo orderId (distinta Idempotency-Key, en paralelo)
 *     -> exactamente 1 exito (201); el resto 409; el stock se descuenta 1 vez.
 *        (guarda real: indice unico parcial uq_reservations_active_order)
 *  B. Confirmar y liberar el MISMO pedido en paralelo
 *     -> exactamente 1 gana (200); el otro 409; sin doble efecto en el stock.
 *        (guarda real: SELECT ... FOR UPDATE + transicion condicional)
 *  C. Replay concurrente de la MISMA Idempotency-Key
 *     -> 1 exito (201) y el resto 200 (replay) o 409; NUNCA 500.
 *
 * Uso:
 *   node scripts/concurrency-lifecycle-test.mjs                    # contra Render
 *   node scripts/concurrency-lifecycle-test.mjs http://localhost:3006
 */

const BASE_URL = process.argv[2] || "https://inventario-g7.onrender.com";
const PRODUCT_ID = "550e8400-e29b-41d4-a716-446655440000";
const STOCK_INICIAL = 10;

const AUTH_URL = process.env.AUTH_BASE_URL || "https://auth-minimarket-cloud.onrender.com";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "maria@correo.cl";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "AdminClave123";

const uuid = () => crypto.randomUUID();
let fallas = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`   ✅ ${msg}`);
  } else {
    console.log(`   ❌ ${msg}`);
    fallas++;
  }
}

async function api(method, path, { body, headers = {} } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Consumer": "concurrency-lifecycle-test",
      "X-Correlation-Id": uuid(),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function getAdminToken() {
  const res = await fetch(`${AUTH_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Consumer": "concurrency-lifecycle-test" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  if (!res.ok) throw new Error(`Login admin G2 fallo: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

async function resetStock(token) {
  const r = await api("POST", `/inventory/${PRODUCT_ID}/stock`, {
    body: { quantity: STOCK_INICIAL, operation: "SET" },
    headers: { "Authorization": `Bearer ${token}`, "Idempotency-Key": uuid() }
  });
  if (r.status !== 200) throw new Error(`No se pudo resetear stock: HTTP ${r.status}`);
}

async function getStock() {
  const r = await api("GET", `/inventory/${PRODUCT_ID}`);
  return r.body;
}

function reserve(orderId, idempotencyKey) {
  return api("POST", "/inventory/reserve", {
    body: { orderId, items: [{ productId: PRODUCT_ID, quantity: 1 }] },
    headers: { "Idempotency-Key": idempotencyKey }
  });
}

async function main() {
  console.log(`=== Pruebas de concurrencia del ciclo de vida ===`);
  console.log(`Base URL: ${BASE_URL}\n`);

  const token = await getAdminToken();

  // --------------------------------------------------------
  // A. Doble reserva del mismo orderId (claves distintas)
  // --------------------------------------------------------
  console.log("A. Doble reserva del mismo orderId (6 en paralelo, claves distintas)");
  await resetStock(token);
  const orderA = `ORD-LIFE-A-${Date.now()}`;

  const rA = await Promise.all(
    Array.from({ length: 6 }, () => reserve(orderA, uuid()))
  );
  const okA = rA.filter(r => r.status === 201);
  const dupA = rA.filter(r => r.status === 409);
  const errA = rA.filter(r => ![201, 409].includes(r.status));
  const stockA = await getStock();

  assert(okA.length === 1, `exactamente 1 reserva exitosa (hubo ${okA.length})`);
  assert(dupA.length === 5, `las otras 5 rechazadas con 409 (hubo ${dupA.length}: ${dupA.map(r => r.body.code).join(",")})`);
  assert(errA.length === 0, `sin errores inesperados (hubo ${errA.length}: ${errA.map(r => r.status).join(",")})`);
  assert(
    stockA.availableStock === STOCK_INICIAL - 1 && stockA.reservedStock === 1,
    `stock descontado UNA sola vez (available=${stockA.availableStock}, reserved=${stockA.reservedStock})`
  );

  // --------------------------------------------------------
  // B. Confirmar y liberar el mismo pedido EN PARALELO
  // --------------------------------------------------------
  console.log("\nB. Confirm y release simultaneos del mismo pedido");
  const [conf, rel] = await Promise.all([
    api("POST", "/inventory/confirm", { body: { orderId: orderA } }),
    api("POST", "/inventory/release", { body: { orderId: orderA } })
  ]);
  const stockB = await getStock();
  const ganadores = [conf, rel].filter(r => r.status === 200);
  const perdedores = [conf, rel].filter(r => r.status === 409);

  assert(ganadores.length === 1, `exactamente 1 operacion gano con 200 (hubo ${ganadores.length})`);
  assert(perdedores.length === 1, `la otra recibio 409 (hubo ${perdedores.length})`);
  assert(stockB.reservedStock === 0, `reservedStock volvio a 0 (=${stockB.reservedStock})`);
  const efectoUnico =
    (conf.status === 200 && stockB.availableStock === STOCK_INICIAL - 1) || // confirmo: la unidad salio
    (rel.status === 200 && stockB.availableStock === STOCK_INICIAL);        // libero: la unidad volvio
  assert(efectoUnico, `un solo efecto aplicado (gano ${conf.status === 200 ? "confirm" : "release"}, available=${stockB.availableStock})`);

  // --------------------------------------------------------
  // C. Replay concurrente de la MISMA Idempotency-Key
  // --------------------------------------------------------
  console.log("\nC. Replay concurrente de la misma Idempotency-Key (6 en paralelo)");
  await resetStock(token);
  const orderC = `ORD-LIFE-C-${Date.now()}`;
  const keyC = uuid();

  const rC = await Promise.all(
    Array.from({ length: 6 }, () => reserve(orderC, keyC))
  );
  const okC = rC.filter(r => r.status === 201);
  const replayC = rC.filter(r => [200, 409].includes(r.status));
  const err500C = rC.filter(r => r.status >= 500);
  const stockC = await getStock();

  assert(okC.length === 1, `exactamente 1 creo la reserva (201) (hubo ${okC.length})`);
  assert(replayC.length === 5, `los otros 5 fueron replay/duplicado 200|409 (hubo ${replayC.length})`);
  assert(err500C.length === 0, `NINGUN 500 (hubo ${err500C.length})`);
  assert(
    stockC.availableStock === STOCK_INICIAL - 1 && stockC.reservedStock === 1,
    `stock descontado UNA sola vez (available=${stockC.availableStock}, reserved=${stockC.reservedStock})`
  );

  // Limpieza: liberar la reserva de C para no dejar stock colgado.
  await api("POST", "/inventory/release", { body: { orderId: orderC } });

  console.log(`\n${fallas === 0 ? "✅ TODAS LAS PRUEBAS PASAN" : `❌ ${fallas} verificacion(es) fallaron`}`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando la prueba:", err.message);
  process.exit(1);
});
