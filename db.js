const path = require('path');

const DATABASE_URL =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL_UNPOOLED;

let queryImpl;
// Ejecuta varias consultas en una transacción: o entran todas o no entra
// ninguna. Hace falta para cambiar un pedido, que es borrar lo que había y
// meter lo nuevo; a medias dejaría un pedido vacío.
let transaccionImpl;

if (DATABASE_URL) {
    // Producción / cualquier Postgres real (Neon, Supabase... vía Vercel Marketplace)
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: DATABASE_URL.includes('sslmode=') ? undefined : { rejectUnauthorized: false },
        max: 3,
    });
    queryImpl = (text, params = []) => pool.query(text, params);
    transaccionImpl = async (fn) => {
        const cliente = await pool.connect();
        try {
            await cliente.query('BEGIN');
            const resultado = await fn((text, params = []) => cliente.query(text, params));
            await cliente.query('COMMIT');
            return resultado;
        } catch (err) {
            await cliente.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            cliente.release();
        }
    };
} else {
    // Desarrollo local sin credenciales en la nube: Postgres embebido en disco
    const { PGlite } = require('@electric-sql/pglite');
    const dataDir = path.join(__dirname, 'data', 'pglite');
    // PGlite crea su propia carpeta, pero no la de arriba: en un clon recién
    // bajado (data/ no está en el repositorio) fallaría al arrancar.
    require('fs').mkdirSync(path.dirname(dataDir), { recursive: true });
    const pglite = new PGlite(dataDir);
    queryImpl = async (text, params = []) => {
        const resultado = await pglite.query(text, params);
        return { rows: resultado.rows };
    };
    transaccionImpl = (fn) => pglite.transaction(async (tx) => fn(async (text, params = []) => {
        const resultado = await tx.query(text, params);
        return { rows: resultado.rows };
    }));
}

// Duración del turno: pasados estos minutos el pedido se borra solo, así el
// segundo turno ve el resumen limpio y quien ya pidió puede volver a pedir.
// Se puede cambiar con la variable de entorno MINUTOS_TURNO.
const MINUTOS_TURNO = Math.min(1440, Math.max(1, Math.round(Number(process.env.MINUTOS_TURNO) || 25)));

// El primer turno, el del aviso de la mañana, no caduca a los 25 minutos:
// aguanta entero hasta esta hora, que es cuando se baja al bar. Todo lo pedido
// antes se borra a la vez a esta hora, y a partir de ahí cada pedido dura
// MINUTOS_TURNO como siempre. Se puede cambiar con FIN_PRIMER_TURNO (HH:MM).
const FIN_PRIMER_TURNO = /^([01]?\d|2[0-3]):[0-5]\d$/.test(process.env.FIN_PRIMER_TURNO || '')
    ? process.env.FIN_PRIMER_TURNO
    : '11:15';

// La hora del laboratorio, no la del servidor (Vercel va en UTC)
const ZONA_HORARIA = 'Europe/Madrid';

// Si ahora mismo es el primer turno. MINUTOS_TURNO es un número finito y
// FIN_PRIMER_TURNO ha pasado por la expresión regular de arriba, así que
// interpolarlos en estas consultas es seguro.
const SQL_ES_PRIMER_TURNO =
    `((now() AT TIME ZONE '${ZONA_HORARIA}')::time < '${FIN_PRIMER_TURNO}'::time)`;

// Cuándo caduca un pedido hecho ahora mismo. Se calcula una vez, al crearlo, y
// se guarda en el propio pedido: así cambiarlo luego no alarga el turno.
const SQL_EXPIRA_AHORA = `CASE
    WHEN ${SQL_ES_PRIMER_TURNO}
    THEN (date_trunc('day', now() AT TIME ZONE '${ZONA_HORARIA}') + '${FIN_PRIMER_TURNO}'::time)
         AT TIME ZONE '${ZONA_HORARIA}'
    ELSE now() + INTERVAL '${MINUTOS_TURNO} minutes'
END`;

const SQL_BORRAR_CADUCADOS = `DELETE FROM pedidos WHERE expira_en <= now()`;

const ESQUEMA = [
    `CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre TEXT UNIQUE NOT NULL
    )`,
    // Ya no hay contraseña: se entra solo con el nombre. Si la base de datos
    // viene del esquema anterior, la columna sobra.
    `ALTER TABLE usuarios DROP COLUMN IF EXISTS password`,
    // Un pedido = una persona y un momento. Lo que se pide de verdad (que
    // pueden ser varias bebidas y varios pinchos) va en pedido_items.
    `CREATE TABLE IF NOT EXISTS pedidos (
        id SERIAL PRIMARY KEY,
        usuario TEXT NOT NULL REFERENCES usuarios(nombre) ON DELETE CASCADE,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // Migración del esquema anterior, en el que el pedido era una sola bebida
    // y un solo pincho en columnas de esta misma tabla.
    `ALTER TABLE pedidos DROP COLUMN IF EXISTS tipo_cafe`,
    `ALTER TABLE pedidos DROP COLUMN IF EXISTS hielo`,
    `ALTER TABLE pedidos DROP COLUMN IF EXISTS pincho`,
    `ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_usuario_fecha_key`,
    `ALTER TABLE pedidos DROP COLUMN IF EXISTS fecha`,
    // Ya no se elige bar: hay una sola carta con todo junto
    `DROP INDEX IF EXISTS pedidos_usuario_bar_unico`,
    `ALTER TABLE pedidos DROP COLUMN IF EXISTS bar`,
    `CREATE TABLE IF NOT EXISTS pedido_items (
        id SERIAL PRIMARY KEY,
        pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
        clase TEXT NOT NULL,
        nombre TEXT NOT NULL,
        hielo BOOLEAN NOT NULL DEFAULT FALSE
    )`,
    `CREATE INDEX IF NOT EXISTS pedido_items_pedido ON pedido_items (pedido_id)`,
    // Cuántas de cada cosa (dos cafés con leche son una fila con cantidad 2) y
    // si el croissant va a la plancha.
    `ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS cantidad INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS plancha BOOLEAN NOT NULL DEFAULT FALSE`,
    // Cuándo se cambió el pedido por última vez (vacío si no se ha tocado) y
    // cuándo caduca. Los pedidos de antes de existir la columna caducan como
    // caducaban entonces, a los MINUTOS_TURNO de hacerse.
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS expira_en TIMESTAMPTZ`,
    `UPDATE pedidos SET expira_en = creado_en + INTERVAL '${MINUTOS_TURNO} minutes' WHERE expira_en IS NULL`,
    `ALTER TABLE pedidos ALTER COLUMN expira_en SET NOT NULL`,
    // Ajustes internos del servidor. Guarda el secreto que firma las sesiones
    // para que todas las instancias de Vercel usen el mismo: si cada una se
    // inventa el suyo, el token que da el login lo rechaza la siguiente.
    `CREATE TABLE IF NOT EXISTS ajustes (
        clave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
    )`,
    // La preferencia vuelve a ser una por persona. Las tablas anteriores
    // tenían otra forma (una era por bar), así que no se pueden migrar: se
    // rehace sola con el primer pedido de cada uno.
    `DROP TABLE IF EXISTS preferencias`,
    `DROP TABLE IF EXISTS preferencias_bar`,
    `CREATE TABLE IF NOT EXISTS preferencias_usuario (
        usuario TEXT PRIMARY KEY REFERENCES usuarios(nombre) ON DELETE CASCADE,
        items TEXT NOT NULL,
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // La lista de la compra del laboratorio. No caduca como los pedidos: se
    // queda hasta que alguien la borre, que para eso se compra cuando se
    // puede. A propósito no se guarda quién apuntó cada cosa: la lista es del
    // laboratorio, no de nadie.
    `CREATE TABLE IF NOT EXISTS lista_compra (
        id SERIAL PRIMARY KEY,
        articulo TEXT NOT NULL,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // Sin repetidos aunque lo apunten tres personas y con distintas mayúsculas
    `CREATE UNIQUE INDEX IF NOT EXISTS lista_compra_articulo ON lista_compra (lower(articulo))`,
    // Los móviles que han dicho "avísame". La clave es el endpoint que da el
    // navegador: identifica a ese móvil y ese navegador, así que quien use dos
    // aparatos tiene dos filas y recibe el aviso en los dos.
    `CREATE TABLE IF NOT EXISTS suscripciones (
        endpoint TEXT PRIMARY KEY,
        usuario TEXT NOT NULL REFERENCES usuarios(nombre) ON DELETE CASCADE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    SQL_BORRAR_CADUCADOS,
    // Al quitar el bar, quien tuviera un pedido vivo en cada uno se quedaría
    // con dos: se conserva el último y así el índice de abajo puede crearse.
    `DELETE FROM pedidos AS p WHERE EXISTS (
        SELECT 1 FROM pedidos AS q
         WHERE q.usuario = p.usuario AND (q.creado_en, q.id) > (p.creado_en, p.id)
    )`,
    // La unicidad es por persona: mientras tu pedido siga vivo no puedes pedir
    // otro, y al caducar sí.
    `CREATE UNIQUE INDEX IF NOT EXISTS pedidos_usuario_unico ON pedidos (usuario)`,
];

// Los 18 empleados. Para entrar basta con el nombre.
const USUARIOS_INICIALES = [
    'Aaron', 'Adrian', 'Alberto', 'Alvaro', 'Angel', 'Christian',
    'Cristian', 'Cristina', 'Diego', 'Jorge', 'Jose', 'Juan Carlos',
    'Julio', 'Marcos', 'Pedro', 'Roberto', 'Santos', 'Susana',
];

let listo;
function init() {
    if (!listo) {
        listo = (async () => {
            for (const sentencia of ESQUEMA) {
                await queryImpl(sentencia);
            }
            for (const nombre of USUARIOS_INICIALES) {
                await queryImpl(
                    `INSERT INTO usuarios (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING`,
                    [nombre]
                );
            }
        })();
    }
    return listo;
}

async function query(text, params) {
    await init();
    return queryImpl(text, params);
}

// La función recibe un `q(sql, params)` que va contra la transacción abierta.
// Si lanza, no se guarda nada.
async function transaccion(fn) {
    await init();
    return transaccionImpl(fn);
}

// Borra los pedidos caducados. No hay proceso en segundo plano (en Vercel las
// funciones son efímeras): se limpia al pedir y al mirar el resumen, que es
// justo cuando importa que la lista esté al día.
async function limpiarPedidosCaducados() {
    return query(SQL_BORRAR_CADUCADOS);
}

// Lee un ajuste; si no existe lo crea con el valor propuesto. Devuelve
// siempre el valor que quedó guardado, así dos instancias que arranquen a la
// vez acaban con el mismo (gana la que insertó primero).
async function ajusteEstable(clave, valorPropuesto) {
    await query(
        `INSERT INTO ajustes (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO NOTHING`,
        [clave, valorPropuesto]
    );
    const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = $1`, [clave]);
    return rows[0] ? rows[0].valor : valorPropuesto;
}

module.exports = {
    query, transaccion, limpiarPedidosCaducados, ajusteEstable,
    MINUTOS_TURNO, FIN_PRIMER_TURNO, SQL_EXPIRA_AHORA, SQL_ES_PRIMER_TURNO,
};
