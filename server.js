const express = require('express');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');
const db = require('./db');
const catalogo = require('./public/catalogo');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Admite lo que hay en la carta o, para "Otro", cualquier texto corto. Se
// queda con las cosas válidas y descarta el resto: lo que no vale es que no
// quede nada.
function normalizarItems(items) {
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

        salida.push({
            clase: item.clase,
            nombre,
            // El hielo solo vale en los cafés de la carta, venga lo que venga
            hielo: catalogo.admiteHielo(item.clase, nombre) && Boolean(item.hielo),
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

// Claves VAPID: son las que firman los avisos y le dicen al navegador que el
// que empuja es este servidor y no otro. Tienen que ser SIEMPRE las mismas: si
// cambian, todos los móviles suscritos dejan de recibir y hay que volver a
// pedirles el permiso. Por eso, igual que el secreto de sesión, se guardan en
// la base de datos si no vienen por variable de entorno. Las dos claves van
// juntas en una sola fila a propósito: guardadas por separado, dos instancias
// arrancando a la vez podrían dejar la pública de una con la privada de otra.
let promesaVapid;
function obtenerVapid() {
    if (!promesaVapid) {
        promesaVapid = (async () => {
            if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
                return {
                    publicKey: process.env.VAPID_PUBLIC_KEY,
                    privateKey: process.env.VAPID_PRIVATE_KEY,
                };
            }
            const guardado = await db.ajusteEstable('vapid', JSON.stringify(webpush.generateVAPIDKeys()));
            return JSON.parse(guardado);
        })();
    }
    return promesaVapid;
}

// A quién quejarse si un aviso da problemas: lo exige el estándar
const VAPID_CONTACTO = process.env.VAPID_SUBJECT || 'mailto:cafendo@slclab.local';

async function prepararEnvio() {
    const claves = await obtenerVapid();
    webpush.setVapidDetails(VAPID_CONTACTO, claves.publicKey, claves.privateKey);
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

// Lo último que pidió esta persona, para poder ofrecérselo si vuelve otro día
app.get('/api/preferencia', requireAuth, async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT items, (actualizado_en < CURRENT_DATE) AS de_otro_dia
             FROM preferencias_usuario WHERE usuario = $1`,
            [req.usuario]
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

// Cuánto le queda vivo a un pedido, en segundos. Se calcula en la base de
// datos para no depender de la hora del móvil.
const SQL_SEGUNDOS_RESTANTES =
    `GREATEST(0, EXTRACT(EPOCH FROM (creado_en + ($2::int * INTERVAL '1 minute') - now())))::int`;

// Mi pedido de este turno, para poder repasarlo y cambiarlo
app.get('/api/mi-pedido', requireAuth, async (req, res) => {
    try {
        await db.limpiarPedidosCaducados();

        const { rows } = await db.query(
            `SELECT ${SQL_SEGUNDOS_RESTANTES} AS segundos, i.clase, i.nombre, i.hielo
             FROM pedidos p
             LEFT JOIN pedido_items i ON i.pedido_id = p.id
             WHERE p.usuario = $1
             ORDER BY i.id`,
            [req.usuario, db.MINUTOS_TURNO]
        );

        if (rows.length === 0) return res.json({ hay: false });

        res.json({
            hay: true,
            msRestantes: rows[0].segundos * 1000,
            items: rows
                .filter(fila => fila.nombre)
                .map(fila => ({ clase: fila.clase, nombre: fila.nombre, hielo: Boolean(fila.hielo) })),
        });
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Guardar el pedido: si ya hay uno vivo de esta persona, se cambia por lo
// nuevo en vez de rechazarlo. Se respeta la hora del pedido original, así que
// cambiarlo no alarga el turno ni retrasa la caducidad.
app.post('/api/pedidos', requireAuth, async (req, res) => {
    const items = normalizarItems(req.body.items);
    if (items.length === 0) {
        return res.status(400).json({ error: 'Elige al menos una bebida o un pincho.' });
    }

    try {
        await db.limpiarPedidosCaducados();

        // Todo en una transacción: quitar lo viejo y poner lo nuevo no puede
        // quedarse a medias y dejar el pedido vacío.
        const guardado = await db.transaccion(async (q) => {
            const previo = await q(`SELECT id FROM pedidos WHERE usuario = $1`, [req.usuario]);

            const { rows } = await q(
                `INSERT INTO pedidos (usuario)
                 VALUES ($1)
                 ON CONFLICT (usuario) DO UPDATE SET usuario = EXCLUDED.usuario
                 RETURNING id, ${SQL_SEGUNDOS_RESTANTES} AS segundos`,
                [req.usuario, db.MINUTOS_TURNO]
            );
            const pedidoId = rows[0].id;

            await q(`DELETE FROM pedido_items WHERE pedido_id = $1`, [pedidoId]);

            const valores = [];
            const marcadores = items.map((item, i) => {
                valores.push(pedidoId, item.clase, item.nombre, item.hielo);
                const base = i * 4;
                return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
            });
            await q(
                `INSERT INTO pedido_items (pedido_id, clase, nombre, hielo) VALUES ${marcadores.join(', ')}`,
                valores
            );

            return {
                id: pedidoId,
                msRestantes: rows[0].segundos * 1000,
                modificado: previo.rows.length > 0,
                // Lo que ha quedado guardado de verdad (ya normalizado), para
                // que la pantalla enseñe eso y no lo que creía haber mandado
                items,
            };
        });

        // Se guarda como preferencia para ofrecérsela otro día. Si esto falla
        // no se rompe el pedido, que es lo que de verdad importa.
        try {
            await db.query(
                `INSERT INTO preferencias_usuario (usuario, items, actualizado_en)
                 VALUES ($1, $2, now())
                 ON CONFLICT (usuario) DO UPDATE
                 SET items = EXCLUDED.items,
                     actualizado_en = EXCLUDED.actualizado_en`,
                [req.usuario, JSON.stringify(items)]
            );
        } catch {
            // La preferencia es un extra: si no se puede guardar, se sigue.
        }

        res.status(200).json(guardado);
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Anular mi pedido: quien se arrepiente lo quita del turno y puede volver a
// pedir de cero cuando quiera.
app.delete('/api/mi-pedido', requireAuth, async (req, res) => {
    try {
        await db.query(`DELETE FROM pedidos WHERE usuario = $1`, [req.usuario]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// --- Avisos diarios ------------------------------------------------------

// La clave pública, que el móvil necesita para suscribirse. Es pública de
// verdad: no hay nada que esconder aquí.
app.get('/api/push/clave', requireAuth, async (req, res) => {
    try {
        const claves = await obtenerVapid();
        res.json({ clave: claves.publicKey });
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// "Avísame todos los días": el móvil manda aquí su suscripción
app.post('/api/push/suscribir', requireAuth, async (req, res) => {
    const suscripcion = req.body || {};
    const endpoint = String(suscripcion.endpoint || '');
    const p256dh = String(suscripcion.keys?.p256dh || '');
    const auth = String(suscripcion.keys?.auth || '');

    if (!endpoint.startsWith('https://') || !p256dh || !auth) {
        return res.status(400).json({ error: 'Suscripción no válida.' });
    }

    try {
        // Si ese móvil ya estaba apuntado se actualiza. Puede haber cambiado de
        // persona (movil compartido) o haber renovado sus claves.
        await db.query(
            `INSERT INTO suscripciones (endpoint, usuario, p256dh, auth)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (endpoint) DO UPDATE
             SET usuario = EXCLUDED.usuario, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
            [endpoint, req.usuario, p256dh, auth]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// "Ya no quiero avisos"
app.delete('/api/push/suscribir', requireAuth, async (req, res) => {
    const endpoint = String(req.body?.endpoint || '');
    if (!endpoint) return res.status(400).json({ error: 'Falta la suscripción.' });

    try {
        await db.query(`DELETE FROM suscripciones WHERE endpoint = $1`, [endpoint]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// El aviso de las 10:30. Lo llama un cron externo, no una persona, así que va
// con su propio token en la cabecera (no en la URL, que acaba en los registros
// de medio mundo).
app.post('/api/avisar', async (req, res) => {
    const esperado = process.env.CRON_TOKEN;
    if (!esperado) {
        return res.status(503).json({ error: 'Falta configurar CRON_TOKEN.' });
    }

    const [tipo, recibido] = (req.headers.authorization || '').split(' ');
    const bufRecibido = Buffer.from(tipo === 'Bearer' ? recibido || '' : '');
    const bufEsperado = Buffer.from(esperado);
    if (bufRecibido.length !== bufEsperado.length || !crypto.timingSafeEqual(bufRecibido, bufEsperado)) {
        return res.status(401).json({ error: 'No autorizado.' });
    }

    try {
        await prepararEnvio();
        const { rows } = await db.query(`SELECT endpoint, p256dh, auth FROM suscripciones`);

        const carga = JSON.stringify({
            titulo: 'Cafendo',
            cuerpo: '¿Qué quieres hoy?',
            url: '/app.html',
        });

        let enviados = 0;
        const caducadas = [];
        const errores = [];

        await Promise.all(rows.map(async (fila) => {
            try {
                await webpush.sendNotification(
                    { endpoint: fila.endpoint, keys: { p256dh: fila.p256dh, auth: fila.auth } },
                    carga
                );
                enviados++;
            } catch (err) {
                // 404/410 = ese móvil ya no existe (app borrada, permiso
                // quitado). Se limpia para no arrastrar suscripciones muertas.
                if (err.statusCode === 404 || err.statusCode === 410) {
                    caducadas.push(fila.endpoint);
                    return;
                }
                // Lo demás es un problema de verdad (configuración, red...) y
                // hay que verlo: si no, los avisos dejan de llegar un día y
                // nadie se entera nunca.
                errores.push(err.statusCode ? `HTTP ${err.statusCode}` : err.code || err.message || 'desconocido');
            }
        }));

        if (caducadas.length > 0) {
            await db.query(`DELETE FROM suscripciones WHERE endpoint = ANY($1)`, [caducadas]);
        }

        if (errores.length > 0) {
            console.error(`[avisar] ${errores.length} avisos fallaron:`, [...new Set(errores)].join(', '));
        }

        // Si fallaron todos habiendo a quien avisar, se responde con error para
        // que el cron lo cante en vez de dar por buena una mañana sin avisos.
        const codigo = rows.length > 0 && enviados === 0 && errores.length > 0 ? 500 : 200;
        res.status(codigo).json({
            enviados,
            caducadas: caducadas.length,
            fallidos: errores.length,
            total: rows.length,
            detalle: [...new Set(errores)],
        });
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Resumen del turno actual (solo los pedidos que siguen vivos)
app.get('/api/resumen', requireAuth, async (req, res) => {
    try {
        await db.limpiarPedidosCaducados();
        const { rows } = await db.query(
            `SELECT p.id, p.usuario, i.clase, i.nombre, i.hielo
             FROM pedidos p
             JOIN pedido_items i ON i.pedido_id = p.id
             ORDER BY p.creado_en, i.id`
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

// Finalizar el turno a mano, sin esperar a que caduquen
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
