const express = require('express');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');
const db = require('./db');
const catalogo = require('./public/catalogo');

const app = express();
// Detrás del proxy de Vercel, sin esto req.protocol dice "http" aunque la
// petición viniera por HTTPS, y las URLs que construimos salen mal.
app.set('trust proxy', true);
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

// Igual que con la carta: valen los de la lista o, para "Otro", texto corto.
// Se descartan los repetidos dentro de la misma tanda.
function normalizarArticulos(articulos) {
    if (!Array.isArray(articulos)) return [];

    const vistos = new Set();
    const salida = [];

    for (const suelto of articulos) {
        if (salida.length >= catalogo.maxItems) break;

        const articulo = String(suelto || '').trim();
        if (!articulo || articulo.length > catalogo.maxLongitudOtro) continue;

        const clave = articulo.toLowerCase();
        if (vistos.has(clave)) continue;
        vistos.add(clave);

        salida.push(articulo);
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
            // Se recortan por lo mismo que el token del cron: un salto de
            // línea colado al pegarlas en el panel las invalidaría, y aquí el
            // síntoma sería que los avisos dejan de llegar sin más.
            const publica = (process.env.VAPID_PUBLIC_KEY || '').trim();
            const privada = (process.env.VAPID_PRIVATE_KEY || '').trim();
            if (publica && privada) {
                return { publicKey: publica, privateKey: privada };
            }
            const guardado = await db.ajusteEstable('vapid', JSON.stringify(webpush.generateVAPIDKeys()));
            return JSON.parse(guardado);
        })();
    }
    return promesaVapid;
}

// A quién acudir si un aviso da problemas: lo exige el estándar, y tiene que
// ser una dirección de verdad. Apple, en concreto, rechaza los avisos con un
// 403 si el contacto no le convence, y el síntoma es de los peores: los avisos
// no llegan y no hay nada en la app que lo delate. Por eso el valor por
// defecto es la propia dirección de la web, que siempre existe, en vez de un
// correo inventado.
function contactoVapid(base) {
    const puesto = (process.env.VAPID_SUBJECT || '').trim();
    if (puesto) return puesto;
    return base && base.startsWith('https://') ? base : 'https://cafendo.example';
}

async function prepararEnvio(base) {
    const claves = await obtenerVapid();
    webpush.setVapidDetails(contactoVapid(base), claves.publicKey, claves.privateKey);
}

// La contraseña con la que el cron externo dispara el aviso diario. Si hay
// variable de entorno manda esa; si no, se genera una y se guarda en la base
// de datos, para no depender de poder tocar la configuración del hosting.
// Se consulta desde la app con /api/avisar/config.
let promesaTokenCron;
function obtenerTokenCron() {
    if (!promesaTokenCron) {
        promesaTokenCron = (async () => {
            // El .trim() no es capricho: al pegar un valor en el panel de un
            // hosting se cuela un salto de línea con muchísima facilidad, y sin
            // esto no coincide nunca con el que escribes y no hay forma humana
            // de ver por qué.
            const deEntorno = (process.env.CRON_TOKEN || '').trim();
            if (deEntorno) return deEntorno;
            return db.ajusteEstable('cron_token', crypto.randomBytes(32).toString('hex'));
        })();
    }
    return promesaTokenCron;
}

// Freno: como mucho un aviso por minuto, contado en la base de datos para que
// valga aunque cada petición caiga en una instancia distinta de Vercel. La
// condición del UPDATE lo hace atómico: si dos llegan a la vez, solo una pasa.
async function pasaElFreno() {
    try {
        const { rows } = await db.query(
            `INSERT INTO ajustes (clave, valor) VALUES ('ultimo_aviso', now()::text)
             ON CONFLICT (clave) DO UPDATE SET valor = now()::text
             WHERE ajustes.valor::timestamptz < now() - INTERVAL '1 minute'
             RETURNING valor`
        );
        return rows.length > 0;
    } catch (err) {
        // Si el freno falla, mejor mandar el aviso que quedarse sin él
        return true;
    }
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

// --- Lista de la compra --------------------------------------------------

// Manda un aviso a una persona (a todos sus móviles). Devuelve a cuántos llegó.
async function avisarA(nombre, cuerpo, base) {
    const { rows } = await db.query(
        `SELECT endpoint, p256dh, auth FROM suscripciones WHERE usuario = $1`,
        [nombre]
    );
    if (rows.length === 0) return 0;

    await prepararEnvio(base);
    const carga = JSON.stringify({ titulo: 'Cafendo', cuerpo, url: '/compra.html' });

    let llegaron = 0;
    await Promise.all(rows.map(async (fila) => {
        try {
            await webpush.sendNotification(
                { endpoint: fila.endpoint, keys: { p256dh: fila.p256dh, auth: fila.auth } },
                carga
            );
            llegaron++;
        } catch (err) {
            if (err.statusCode === 404 || err.statusCode === 410) {
                await db.query(`DELETE FROM suscripciones WHERE endpoint = $1`, [fila.endpoint]).catch(() => {});
            }
        }
    }));
    return llegaron;
}

app.get('/api/compra', requireAuth, async (req, res) => {
    try {
        const { rows } = await db.query(`SELECT articulo FROM lista_compra ORDER BY creado_en, id`);
        res.json(rows.map(fila => fila.articulo));
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Apuntar artículos. Los que ya estaban no se duplican ni vuelven a avisar.
app.post('/api/compra', requireAuth, async (req, res) => {
    const articulos = normalizarArticulos(req.body.articulos);
    if (articulos.length === 0) {
        return res.status(400).json({ error: 'Elige al menos un artículo.' });
    }

    try {
        const { rows } = await db.query(
            `INSERT INTO lista_compra (articulo)
             SELECT * FROM unnest($1::text[])
             ON CONFLICT (lower(articulo)) DO NOTHING
             RETURNING articulo`,
            [articulos]
        );
        const nuevos = rows.map(fila => fila.articulo);

        res.json({ nuevos, repetidos: articulos.length - nuevos.length });

        // Solo se avisa si de verdad se ha apuntado algo nuevo: apuntar lo que
        // ya estaba no es noticia para quien va a comprar.
        if (nuevos.length > 0) {
            const cuerpo = nuevos.length === 1
                ? 'Se ha añadido un nuevo artículo a la lista de la compra'
                : `Se han añadido ${nuevos.length} artículos a la lista de la compra`;
            try {
                await avisarA(catalogo.avisarCompraA, cuerpo, `${req.protocol}://${req.get('host')}`);
            } catch (err) {
                // El artículo ya está guardado, que es lo que importa
                console.error('[compra] no se pudo avisar:', err.statusCode || err.message);
            }
        }
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Ya está todo comprado: se vacía la lista
app.delete('/api/compra', requireAuth, async (req, res) => {
    try {
        await db.query(`DELETE FROM lista_compra`);
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
        const { rows } = await db.query(
            `INSERT INTO suscripciones (endpoint, usuario, p256dh, auth)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (endpoint) DO UPDATE
             SET usuario = EXCLUDED.usuario, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
             RETURNING (xmax = 0) AS es_nueva`,
            [endpoint, req.usuario, p256dh, auth]
        );
        res.json({ success: true });

        // A quien acaba de activarlo se le manda uno enseguida, para que vea
        // que le funciona sin esperar a mañana. Solo la primera vez: la app
        // reenvía la suscripción cada vez que se abre, y sin esto recibiría un
        // aviso en cada apertura.
        if (rows[0] && rows[0].es_nueva) {
            try {
                await prepararEnvio(`${req.protocol}://${req.get('host')}`);
                await webpush.sendNotification(
                    { endpoint, keys: { p256dh, auth } },
                    JSON.stringify({
                        titulo: 'Cafendo',
                        cuerpo: `¡Listo! Te avisaré cada día a las ${catalogo.horaAviso}.`,
                        url: '/app.html',
                    })
                );
            } catch (err) {
                // Que falle el de bienvenida no invalida la suscripción, que
                // es lo que de verdad importa. Ya se respondió que sí.
                console.error('[suscribir] no se pudo mandar el aviso de bienvenida:', err.statusCode || err.message);
            }
        }
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

// Los datos que hay que meter en el servicio de cron. Hace falta sesión: no es
// para todo internet, aunque tampoco es un secreto de estado (lo único que
// permite es lanzar el aviso, y con el freno de un minuto por medio).
app.get('/api/avisar/config', requireAuth, async (req, res) => {
    try {
        const token = await obtenerTokenCron();
        const base = `${req.protocol}://${req.get('host')}`;
        res.json({
            url: `${base}/api/avisar`,
            metodo: 'POST',
            cabecera: `Authorization: Bearer ${token}`,
            horario: '30 10 * * 1-5',
            zona: 'Europe/Madrid',
            origen: process.env.CRON_TOKEN ? 'variable de entorno' : 'base de datos',
        });
    } catch (err) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// El aviso de las 10:30. Lo llama un cron externo, no una persona, así que va
// con su propio token en la cabecera (no en la URL, que acaba en los registros
// de medio mundo).
app.post('/api/avisar', async (req, res) => {
    let esperado;
    try {
        esperado = await obtenerTokenCron();
    } catch (err) {
        return res.status(500).json({ error: 'Error del servidor' });
    }

    const [tipo, recibido] = (req.headers.authorization || '').split(' ');
    const bufRecibido = Buffer.from(tipo === 'Bearer' ? recibido || '' : '');
    const bufEsperado = Buffer.from(esperado);
    if (bufRecibido.length !== bufEsperado.length || !crypto.timingSafeEqual(bufRecibido, bufEsperado)) {
        return res.status(401).json({ error: 'No autorizado.' });
    }

    // Un aviso por minuto como mucho. Protege de un cron mal configurado que
    // reintente en bucle y de que, si el token se filtrara, alguien pudiera
    // freír a notificaciones a todo el laboratorio.
    if (!(await pasaElFreno())) {
        return res.status(429).json({ error: 'Ya se mandó un aviso hace menos de un minuto.' });
    }

    try {
        await prepararEnvio(`${req.protocol}://${req.get('host')}`);
        const { rows } = await db.query(`SELECT endpoint, p256dh, auth FROM suscripciones`);

        const carga = JSON.stringify({
            titulo: 'Cafendo',
            cuerpo: '¿Qué quieres hoy?',
            url: '/app.html',
        });

        let enviados = 0;
        const caducadas = [];
        const rechazadas = [];
        const errores = [];

        await Promise.all(rows.map(async (fila) => {
            try {
                await webpush.sendNotification(
                    { endpoint: fila.endpoint, keys: { p256dh: fila.p256dh, auth: fila.auth } },
                    carga
                );
                enviados++;
            } catch (err) {
                // 403 = el servicio de push no acepta nuestra firma para ese
                // móvil, casi siempre porque se suscribió con unas claves que
                // ya no usamos. Se aparta, pero no se borra todavía: si fallan
                // TODAS con 403 el problema es de configuración y borrarlas
                // dejaría al laboratorio entero sin avisos.
                if (err.statusCode === 403) {
                    rechazadas.push(fila.endpoint);
                    errores.push('HTTP 403');
                    return;
                }
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

        // Las rechazadas solo se borran si a algún otro móvil sí le llegó: eso
        // demuestra que la configuración está bien y que el problema es de esa
        // suscripción concreta. Si no llegó a ninguno, se quedan y el error se
        // canta, que es lo que permite arreglarlo.
        const aBorrar = enviados > 0 ? [...caducadas, ...rechazadas] : caducadas;
        if (aBorrar.length > 0) {
            await db.query(`DELETE FROM suscripciones WHERE endpoint = ANY($1)`, [aBorrar]);
        }

        if (errores.length > 0) {
            console.error(`[avisar] ${errores.length} avisos fallaron:`, [...new Set(errores)].join(', '));
        }

        // Si fallaron todos habiendo a quien avisar, se responde con error para
        // que el cron lo cante en vez de dar por buena una mañana sin avisos.
        const codigo = rows.length > 0 && enviados === 0 && errores.length > 0 ? 500 : 200;
        res.status(codigo).json({
            enviados,
            caducadas: aBorrar.length,
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
