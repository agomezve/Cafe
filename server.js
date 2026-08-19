const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TIPOS_FIJOS = new Set(['Solo', 'Con Leche', 'Cortado']);
const MAX_LONGITUD_OTRO = 40;

// Admite los tres tipos fijos o, para "Otro", cualquier texto corto no vacío
function normalizarTipoCafe(valor) {
    const texto = String(valor || '').trim();
    if (TIPOS_FIJOS.has(texto)) return texto;
    if (texto.length > 0 && texto.length <= MAX_LONGITUD_OTRO) return texto;
    return null;
}
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días: pensado para el móvil instalado

function obtenerSecreto() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

    // Sin variable de entorno (desarrollo local): se genera y se guarda una vez
    // para que las sesiones sobrevivan a reinicios del servidor local.
    const secretPath = path.join(__dirname, 'data', 'secret.key');
    try {
        return fs.readFileSync(secretPath, 'utf8').trim();
    } catch {
        const secreto = crypto.randomBytes(32).toString('hex');
        try {
            fs.mkdirSync(path.dirname(secretPath), { recursive: true });
            fs.writeFileSync(secretPath, secreto);
        } catch {
            // Sistema de archivos de solo lectura (p. ej. sin SESSION_SECRET en
            // producción): seguimos con un secreto en memoria en vez de fallar.
        }
        return secreto;
    }
}
const SECRETO = obtenerSecreto();

function crearToken(nombre) {
    const payload = `${nombre}.${Date.now() + TOKEN_TTL_MS}`;
    const firma = crypto.createHmac('sha256', SECRETO).update(payload).digest('hex');
    return Buffer.from(`${payload}.${firma}`, 'utf8').toString('base64url');
}

function verificarToken(token) {
    try {
        const decodificado = Buffer.from(token, 'base64url').toString('utf8');
        const ultimoPunto = decodificado.lastIndexOf('.');
        const payload = decodificado.slice(0, ultimoPunto);
        const firma = decodificado.slice(ultimoPunto + 1);

        const firmaEsperada = crypto.createHmac('sha256', SECRETO).update(payload).digest('hex');
        const bufFirma = Buffer.from(firma, 'hex');
        const bufEsperada = Buffer.from(firmaEsperada, 'hex');
        if (bufFirma.length !== bufEsperada.length || !crypto.timingSafeEqual(bufFirma, bufEsperada)) {
            return null;
        }

        const separador = payload.lastIndexOf('.');
        const nombre = payload.slice(0, separador);
        const expira = Number(payload.slice(separador + 1));
        if (!expira || Date.now() > expira) return null;

        return nombre;
    } catch {
        return null;
    }
}

function requireAuth(req, res, next) {
    const [tipo, token] = (req.headers.authorization || '').split(' ');
    const nombre = tipo === 'Bearer' && token ? verificarToken(token) : null;
    if (!nombre) {
        return res.status(401).json({ error: 'Sesión no válida. Vuelve a iniciar sesión.' });
    }
    req.usuario = nombre;
    next();
}

// Login
app.post('/api/login', async (req, res) => {
    const usuario = String(req.body.usuario || '').trim();
    const password = String(req.body.password || '').trim();

    if (!usuario || !password) {
        return res.status(400).json({ success: false, message: 'Rellena usuario y contraseña.' });
    }

    try {
        const { rows } = await db.query(
            `SELECT nombre FROM usuarios WHERE nombre ILIKE $1 AND password = $2`,
            [usuario, password]
        );

        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
        }

        const nombreReal = rows[0].nombre;
        res.json({ success: true, nombre: nombreReal, token: crearToken(nombreReal) });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});

// Guardar pedido (uno por persona mientras dure el turno; el índice único
// bloquea los duplicados de forma atómica aunque lleguen dos a la vez)
app.post('/api/pedidos', requireAuth, async (req, res) => {
    const tipoCafe = normalizarTipoCafe(req.body.tipoCafe);

    if (!tipoCafe) {
        return res.status(400).json({ error: 'Tipo de café no válido.' });
    }

    // El hielo solo aplica a los tres tipos fijos; en "Otro" no se ofrece
    const hielo = TIPOS_FIJOS.has(tipoCafe) ? Boolean(req.body.hielo) : false;

    try {
        await db.limpiarPedidosCaducados();

        const { rows } = await db.query(
            `INSERT INTO pedidos (usuario, tipo_cafe, hielo)
             VALUES ($1, $2, $3)
             ON CONFLICT (usuario) DO NOTHING
             RETURNING id`,
            [req.usuario, tipoCafe, hielo]
        );

        if (rows.length === 0) {
            const { rows: pendientes } = await db.query(
                `SELECT CEIL(EXTRACT(EPOCH FROM (creado_en + ($2::int * INTERVAL '1 minute') - now())) / 60)::int AS minutos
                 FROM pedidos WHERE usuario = $1`,
                [req.usuario, db.MINUTOS_TURNO]
            );
            const minutos = pendientes[0] ? Math.max(1, pendientes[0].minutos) : db.MINUTOS_TURNO;
            return res.status(400).json({
                error: `☕ Ya has pedido en este turno. Podrás volver a pedir dentro de ${minutos} min, cuando empiece el siguiente.`
            });
        }

        res.status(200).json({ id: rows[0].id, msRestantes: db.MINUTOS_TURNO * 60 * 1000 });
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Resumen del turno actual (solo los pedidos que siguen vivos)
app.get('/api/resumen', requireAuth, async (req, res) => {
    try {
        await db.limpiarPedidosCaducados();
        const { rows } = await db.query(
            `SELECT usuario, tipo_cafe, hielo FROM pedidos ORDER BY creado_en`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Finalizar turno a mano, sin esperar a que caduquen
app.delete('/api/pedidos', requireAuth, async (req, res) => {
    try {
        await db.query(`DELETE FROM pedidos`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Servidor iniciado en http://localhost:${PORT}`);
    });
}

module.exports = app;
