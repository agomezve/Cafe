const path = require('path');

const DATABASE_URL =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL_UNPOOLED;

let queryImpl;

if (DATABASE_URL) {
    // Producción / cualquier Postgres real (Neon, Supabase... vía Vercel Marketplace)
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: DATABASE_URL.includes('sslmode=') ? undefined : { rejectUnauthorized: false },
        max: 3,
    });
    queryImpl = (text, params = []) => pool.query(text, params);
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
}

// Duración del turno: pasados estos minutos el pedido se borra solo, así el
// segundo turno ve el resumen limpio y quien ya pidió puede volver a pedir.
// Se puede cambiar con la variable de entorno MINUTOS_TURNO.
const MINUTOS_TURNO = Math.min(1440, Math.max(1, Math.round(Number(process.env.MINUTOS_TURNO) || 25)));

// MINUTOS_TURNO siempre es un número finito, así que interpolarlo aquí es seguro
const SQL_BORRAR_CADUCADOS =
    `DELETE FROM pedidos WHERE creado_en < now() - INTERVAL '${MINUTOS_TURNO} minutes'`;

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

module.exports = { query, limpiarPedidosCaducados, ajusteEstable, MINUTOS_TURNO };
