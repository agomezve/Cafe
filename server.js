const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TIPOS_FIJOS = new Set(['Solo', 'Con Leche', 'Cortado', 'Descafeinado']);
const PINCHOS_FIJOS = new Set([
    'Patatas', 'Jeta', 'Gulas', 'Huevos rotos',
    'Lasaña', 'Tortilla', 'Bocadillo', 'Gambas rebozadas',
]);
const MAX_LONGITUD_OTRO = 40;

// Admite los valores del catálogo o, para "Otro", cualquier texto corto no
// vacío. Devuelve null si no hay nada elegido: el café y el pincho son
// opcionales por separado, lo que no vale es no pedir nada.
function normalizarEleccion(valor, catalogo) {
    const texto = String(valor || '').trim();
    if (catalogo.has(texto)) return texto;
    if (texto.length > 0 && texto.length <= MAX_LONGITUD_OTRO) return texto;
    return null;
}

const normalizarTipoCafe = (valor) => normalizarEleccion(valor, TIPOS_FIJOS);
const normalizarPincho = (valor) => normalizarEleccion(valor, PINCHOS_FIJOS);

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días: pensado para el móvil instalado

// El secreto que firma las sesiones tiene que ser el MISMO en todas las
// instancias. En Vercel cada petición puede caer en una función distinta y, si
// cada una se inventa el suyo, el token que dio el login lo rechaza la
// siguiente y te echa de la sesión a media faena. Por eso, cuando no hay
// SESSION_SECRET, se guarda uno en la base de datos y lo comparten todas.
let promesaSecreto;
function obtenerSecreto() {
    if (!promesaSecreto) {
        promesaSecreto = (async () => {
            if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
            try {
                return await db.ajusteEstable('session_secret', crypto.randomBytes(32).toString('hex'));
            } catch {
                // Si la base de datos falla, mejor un secreto en memoria que
                // tirar el servidor: las sesiones durarán menos, nada más.
                return crypto.randomBytes(32).toString('hex');
            }
        })();
    }
    return promesaSecreto;
}

async function crearToken(nombre) {
    const secreto = await obtenerSecreto();
    const payload = `${nombre}.${Date.now() + TOKEN_TTL_MS}`;
    const firma = crypto.createHmac('sha256', secreto).update(payload).digest('hex');
    return Buffer.from(`${payload}.${firma}`, 'utf8').toString('base64url');
}

async function verificarToken(token) {
    try {
        const secreto = await obtenerSecreto();
        const decodificado = Buffer.from(token, 'base64url').toString('utf8');
        const ultimoPunto = decodificado.lastIndexOf('.');
        const payload = decodificado.slice(0, ultimoPunto);
        const firma = decodificado.slice(ultimoPunto + 1);

        const firmaEsperada = crypto.createHmac('sha256', secreto).update(payload).digest('hex');
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

async function requireAuth(req, res, next) {
    const [tipo, token] = (req.headers.authorization || '').split(' ');
    const nombre = tipo === 'Bearer' && token ? await verificarToken(token) : null;
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
        res.json({ success: true, nombre: nombreReal, token: await crearToken(nombreReal) });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});

// Lo último que pidió esta persona, para poder ofrecérselo si vuelve otro día
app.get('/api/preferencia', requireAuth, async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT tipo_cafe, hielo, pincho, actualizado_en,
                    (actualizado_en < CURRENT_DATE) AS de_otro_dia
             FROM preferencias WHERE usuario = $1`,
            [req.usuario]
        );

        if (rows.length === 0) return res.json({ hay: false });

        const preferencia = rows[0];
        res.json({
            hay: true,
            tipoCafe: preferencia.tipo_cafe,
            hielo: Boolean(preferencia.hielo),
            pincho: preferencia.pincho,
            deOtroDia: Boolean(preferencia.de_otro_dia),
        });
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Guardar pedido (uno por persona mientras dure el turno; el índice único
// bloquea los duplicados de forma atómica aunque lleguen dos a la vez)
app.post('/api/pedidos', requireAuth, async (req, res) => {
    const tipoCafe = normalizarTipoCafe(req.body.tipoCafe);
    const pincho = normalizarPincho(req.body.pincho);

    if (!tipoCafe && !pincho) {
        return res.status(400).json({ error: 'Elige un café, un pincho o las dos cosas.' });
    }

    // El hielo solo aplica a los cafés del catálogo; en "Otro" no se ofrece
    const hielo = TIPOS_FIJOS.has(tipoCafe) ? Boolean(req.body.hielo) : false;

    try {
        await db.limpiarPedidosCaducados();

        const { rows } = await db.query(
            `INSERT INTO pedidos (usuario, tipo_cafe, hielo, pincho)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (usuario) DO NOTHING
             RETURNING id`,
            [req.usuario, tipoCafe, hielo, pincho]
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

        // Se guarda como preferencia para ofrecérsela otro día. Si esto falla
        // no se rompe el pedido, que es lo que de verdad importa.
        try {
            await db.query(
                `INSERT INTO preferencias (usuario, tipo_cafe, hielo, pincho, actualizado_en)
                 VALUES ($1, $2, $3, $4, now())
                 ON CONFLICT (usuario) DO UPDATE
                 SET tipo_cafe = EXCLUDED.tipo_cafe,
                     hielo = EXCLUDED.hielo,
                     pincho = EXCLUDED.pincho,
                     actualizado_en = EXCLUDED.actualizado_en`,
                [req.usuario, tipoCafe, hielo, pincho]
            );
        } catch {
            // La preferencia es un extra: si no se puede guardar, se sigue.
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
            `SELECT usuario, tipo_cafe, hielo, pincho FROM pedidos ORDER BY creado_en`
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
