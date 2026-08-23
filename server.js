const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const catalogo = require('./public/catalogo');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Admite lo que hay en la carta del bar o, para "Otro", cualquier texto corto.
// Se queda con las cosas válidas y descarta el resto: lo que no vale es que no
// quede nada.
function normalizarItems(bar, items) {
    if (!Array.isArray(items)) return [];

    const vistos = new Set();
    const salida = [];

    for (const item of items) {
        if (salida.length >= catalogo.maxItems) break;
        if (!item || (item.clase !== 'bebida' && item.clase !== 'pincho')) continue;

        const nombre = String(item.nombre || '').trim();
        if (!nombre || nombre.length > catalogo.maxLongitudOtro) continue;

        const clave = `${item.clase}|${nombre.toLowerCase()}`;
        if (vistos.has(clave)) continue;
        vistos.add(clave);

        // El hielo solo se ofrece en las bebidas de la carta; en "Otro" no se pregunta
        const deLaCarta = catalogo.carta(bar, item.clase).includes(nombre);
        salida.push({
            clase: item.clase,
            nombre,
            hielo: item.clase === 'bebida' && deLaCarta && Boolean(item.hielo),
        });
    }

    return salida;
}

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

// El bar llega en el cuerpo (al pedir) o en la query (al consultar)
function barDePeticion(req) {
    return catalogo.barPorId(req.body?.bar ?? req.query.bar);
}

// Login: solo el nombre. Esto no guarda nada sensible, sirve para saber quién
// quiere cortado; la contraseña común solo estorbaba.
app.post('/api/login', async (req, res) => {
    const usuario = String(req.body.usuario || '').trim();

    if (!usuario) {
        return res.status(400).json({ success: false, message: 'Escribe tu nombre.' });
    }

    try {
        const { rows } = await db.query(
            `SELECT nombre FROM usuarios WHERE lower(nombre) = lower($1)`,
            [usuario]
        );

        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Ese nombre no está en la lista del laboratorio.' });
        }

        const nombreReal = rows[0].nombre;
        res.json({ success: true, nombre: nombreReal, token: await crearToken(nombreReal) });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});

// Lo último que pidió esta persona EN ESTE BAR, para poder ofrecérselo si
// vuelve otro día. Lo que pides en un bar no dice nada de lo que pides en otro.
app.get('/api/preferencia', requireAuth, async (req, res) => {
    const bar = barDePeticion(req);
    if (!bar) return res.status(400).json({ error: 'Bar desconocido.' });

    try {
        const { rows } = await db.query(
            `SELECT items, (actualizado_en < CURRENT_DATE) AS de_otro_dia
             FROM preferencias_bar WHERE usuario = $1 AND bar = $2`,
            [req.usuario, bar.id]
        );

        if (rows.length === 0) return res.json({ hay: false });

        res.json({
            hay: true,
            items: JSON.parse(rows[0].items),
            deOtroDia: Boolean(rows[0].de_otro_dia),
        });
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Guardar pedido (uno por persona y bar mientras dure el turno; el índice
// único bloquea los duplicados de forma atómica aunque lleguen dos a la vez)
app.post('/api/pedidos', requireAuth, async (req, res) => {
    const bar = barDePeticion(req);
    if (!bar) return res.status(400).json({ error: 'Elige un bar antes de pedir.' });

    const items = normalizarItems(bar, req.body.items);
    if (items.length === 0) {
        return res.status(400).json({ error: 'Elige al menos una bebida o un pincho.' });
    }

    try {
        await db.limpiarPedidosCaducados();

        const { rows } = await db.query(
            `INSERT INTO pedidos (usuario, bar)
             VALUES ($1, $2)
             ON CONFLICT (usuario, bar) DO NOTHING
             RETURNING id`,
            [req.usuario, bar.id]
        );

        if (rows.length === 0) {
            const { rows: pendientes } = await db.query(
                `SELECT CEIL(EXTRACT(EPOCH FROM (creado_en + ($3::int * INTERVAL '1 minute') - now())) / 60)::int AS minutos
                 FROM pedidos WHERE usuario = $1 AND bar = $2`,
                [req.usuario, bar.id, db.MINUTOS_TURNO]
            );
            const minutos = pendientes[0] ? Math.max(1, pendientes[0].minutos) : db.MINUTOS_TURNO;
            return res.status(400).json({
                error: `☕ Ya has pedido en este turno. Podrás volver a pedir dentro de ${minutos} min, cuando empiece el siguiente.`
            });
        }

        const pedidoId = rows[0].id;

        try {
            const valores = [];
            const marcadores = items.map((item, i) => {
                valores.push(pedidoId, item.clase, item.nombre, item.hielo);
                const base = i * 4;
                return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
            });
            await db.query(
                `INSERT INTO pedido_items (pedido_id, clase, nombre, hielo) VALUES ${marcadores.join(', ')}`,
                valores
            );
        } catch (err) {
            // Un pedido sin nada dentro sería peor que ninguno: aparecería en
            // el resumen vacío y bloquearía el turno de esa persona.
            await db.query(`DELETE FROM pedidos WHERE id = $1`, [pedidoId]).catch(() => {});
            throw err;
        }

        // Se guarda como preferencia para ofrecérsela otro día. Si esto falla
        // no se rompe el pedido, que es lo que de verdad importa.
        try {
            await db.query(
                `INSERT INTO preferencias_bar (usuario, bar, items, actualizado_en)
                 VALUES ($1, $2, $3, now())
                 ON CONFLICT (usuario, bar) DO UPDATE
                 SET items = EXCLUDED.items,
                     actualizado_en = EXCLUDED.actualizado_en`,
                [req.usuario, bar.id, JSON.stringify(items)]
            );
        } catch {
            // La preferencia es un extra: si no se puede guardar, se sigue.
        }

        res.status(200).json({ id: pedidoId, msRestantes: db.MINUTOS_TURNO * 60 * 1000 });
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Resumen del turno actual en un bar (solo los pedidos que siguen vivos)
app.get('/api/resumen', requireAuth, async (req, res) => {
    const bar = barDePeticion(req);
    if (!bar) return res.status(400).json({ error: 'Bar desconocido.' });

    try {
        await db.limpiarPedidosCaducados();
        const { rows } = await db.query(
            `SELECT p.id, p.usuario, i.clase, i.nombre, i.hielo
             FROM pedidos p
             JOIN pedido_items i ON i.pedido_id = p.id
             WHERE p.bar = $1
             ORDER BY p.creado_en, i.id`,
            [bar.id]
        );

        // Las filas vienen sueltas (una por cosa pedida); se agrupan por
        // persona, que es como se lee el resumen.
        const porPedido = new Map();
        for (const fila of rows) {
            if (!porPedido.has(fila.id)) porPedido.set(fila.id, { usuario: fila.usuario, items: [] });
            porPedido.get(fila.id).items.push({
                clase: fila.clase,
                nombre: fila.nombre,
                hielo: Boolean(fila.hielo),
            });
        }

        res.json([...porPedido.values()]);
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Finalizar el turno de un bar a mano, sin esperar a que caduquen
app.delete('/api/pedidos', requireAuth, async (req, res) => {
    const bar = barDePeticion(req);
    if (!bar) return res.status(400).json({ error: 'Bar desconocido.' });

    try {
        await db.query(`DELETE FROM pedidos WHERE bar = $1`, [bar.id]);
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
