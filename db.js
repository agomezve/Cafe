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
        nombre TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS pedidos (
        id SERIAL PRIMARY KEY,
        usuario TEXT NOT NULL REFERENCES usuarios(nombre) ON DELETE CASCADE,
        tipo_cafe TEXT NOT NULL,
        hielo BOOLEAN NOT NULL DEFAULT FALSE,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // Ajustes internos del servidor. Guarda el secreto que firma las sesiones
    // para que todas las instancias de Vercel usen el mismo: si cada una se
    // inventa el suyo, el token que da el login lo rechaza la siguiente.
    `CREATE TABLE IF NOT EXISTS ajustes (
        clave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
    )`,
    // Lo último que pidió cada uno, para poder ofrecérselo otro día. A
    // diferencia de "pedidos", esto no caduca.
    `CREATE TABLE IF NOT EXISTS preferencias (
        usuario TEXT PRIMARY KEY REFERENCES usuarios(nombre) ON DELETE CASCADE,
        tipo_cafe TEXT,
        hielo BOOLEAN NOT NULL DEFAULT FALSE,
        pincho TEXT,
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    // El pedido pasa a llevar también pincho, y se puede pedir solo una cosa
    // de las dos (café sin pincho o pincho sin café).
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pincho TEXT`,
    `ALTER TABLE pedidos ALTER COLUMN tipo_cafe DROP NOT NULL`,
    // Migración del esquema anterior (un pedido por persona y día). Ahora los
    // pedidos caducan solos, así que la unicidad pasa a ser solo por persona:
    // mientras tu pedido siga vivo no puedes pedir otro, y al caducar sí.
    `ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_usuario_fecha_key`,
    `ALTER TABLE pedidos DROP COLUMN IF EXISTS fecha`,
    SQL_BORRAR_CADUCADOS,
    `CREATE UNIQUE INDEX IF NOT EXISTS pedidos_usuario_unico ON pedidos (usuario)`,
];

// Los 18 empleados con contraseña común inicial (se puede cambiar por fila en la tabla usuarios)
const USUARIOS_INICIALES = [
    'Aaron', 'Adrian', 'Alberto', 'Alvaro', 'Angel', 'Christian',
    'Cristian', 'Cristina', 'Diego', 'Jorge', 'Jose', 'Juan Carlos',
    'Julio', 'Marcos', 'Pedro', 'Roberto', 'Santos', 'Susana',
];
const PASSWORD_INICIAL = process.env.CAFE_PASSWORD_INICIAL || 'labAlfa21';

let listo;
function init() {
    if (!listo) {
        listo = (async () => {
            for (const sentencia of ESQUEMA) {
                await queryImpl(sentencia);
            }
            for (const nombre of USUARIOS_INICIALES) {
                await queryImpl(
                    `INSERT INTO usuarios (nombre, password) VALUES ($1, $2) ON CONFLICT (nombre) DO NOTHING`,
                    [nombre, PASSWORD_INICIAL]
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
