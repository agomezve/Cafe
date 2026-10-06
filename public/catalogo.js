// Catálogo de bebidas y pinchos.
//
// Este archivo lo cargan las dos partes: el navegador con
// <script src="catalogo.js"> (deja `CATALOGO` como global) y el servidor con
// require('./public/catalogo'). Así la lista que se pinta en la pantalla y la
// que valida el servidor son literalmente la misma, y añadir algo a la carta
// es tocar solo aquí.

// Solo los cafés admiten hielo: al Mosto, al Colacao y a la Coca-Cola no se
// les pregunta
const CAFES = ['Solo', 'Con Leche', 'Cortado', 'Descafeinado'];

const BEBIDAS = [...CAFES, 'Mosto', 'Colacao', 'Coca-Cola'];

// Todos los pinchos juntos, sin repetir: ya no se elige bar, así que la carta
// es la suma de lo que había en cada uno.
const PINCHOS = [
    'Patatas', 'Jeta', 'Gulas', 'Huevos rotos',
    'Lasaña', 'Tortilla', 'Bocadillo', 'Gambas rebozadas',
    'Sandwich', 'Vegetal', 'Empanadilla', 'Croissant', 'Rabas', 'Bacalao',
];

// Lo que se puede pedir a la plancha: al marcarlo sale el botón al lado
const A_LA_PLANCHA = ['Croissant'];

// Otras formas de escribir algo de la carta en "Otro", para que cuente como
// lo de la carta y no salga aparte. No hace falta poner las variantes de
// mayúsculas, tildes, espacios o guiones: esas ya se entienden solas.
const ALIAS = {
    'Coca': 'Coca-Cola',
    'Cruasán': 'Croissant',
    'Sandwich vegetal': 'Vegetal',
};

// Lo que suele hacer falta reponer en el laboratorio. Es una lista aparte de
// la del bar: aquí se compra, allí se pide.
const COMPRA = [
    'Café', 'Ambientador', 'Rollos Cocina', 'Papel Higiénico',
    'Vasos', 'Cucharas', 'Galletas', 'Fairy',
    'Jabón manos', 'Cola-Cao', 'Leche', 'Sacarina', 'Azúcar',
];

// A quién le llega el aviso cuando alguien apunta algo en la lista de la
// compra: es quien se encarga de comprarlo. Tiene que ser un nombre de los de
// USUARIOS_INICIALES en db.js, y esa persona debe tener los avisos activados.
const AVISAR_COMPRA_A = 'Julio';

// Lo que se lee en pantalla cuando el nombre corto se queda escueto
const ETIQUETAS = {
    'Solo': 'Café Solo',
    'Con Leche': 'Café con Leche',
};

const ICONOS = {
    'Solo': '☕', 'Con Leche': '🥛', 'Cortado': '🤏', 'Descafeinado': '🌙',
    'Mosto': '🍇', 'Colacao': '🍫', 'Coca-Cola': '🥤',
    'Patatas': '🥔', 'Jeta': '🐷', 'Gulas': '🍜', 'Huevos rotos': '🍳',
    'Lasaña': '🍝', 'Tortilla': '🥚', 'Bocadillo': '🥪', 'Gambas rebozadas': '🍤',
    'Sandwich': '🍞', 'Vegetal': '🥗', 'Empanadilla': '🥟', 'Croissant': '🥐', 'Rabas': '🦑',
    'Bacalao': '🐟',
    'Café': '☕', 'Ambientador': '🌸', 'Rollos Cocina': '🧻', 'Papel Higiénico': '🚻',
    'Vasos': '🥤', 'Cucharas': '🥄', 'Galletas': '🍪', 'Fairy': '🧴',
    'Jabón manos': '🧼', 'Cola-Cao': '🍫', 'Leche': '🥛', 'Sacarina': '🍬',
    'Azúcar': '🧂',
};

// Texto libre de la opción "Otro": corto, que esto acaba en una lista para leer
// en voz alta en la barra.
const MAX_LONGITUD_OTRO = 40;

// Tope de cosas distintas por pedido. Se puede pedir más de una bebida y más
// de un pincho, pero tampoco cien.
const MAX_ITEMS = 15;

// Tope de unidades de una misma cosa (el botón x1, x2... no pasa de aquí)
const MAX_CANTIDAD = 9;

// Hora a la que se manda el aviso diario. Solo es el texto que se lee en la
// app y en la notificación: quien dispara de verdad a esa hora es el servicio
// de cron externo, así que si se cambia aquí hay que cambiarlo también allí.
const HORA_AVISO = '10:30';

// Para comparar lo escrito a mano sin que importen mayúsculas, tildes,
// espacios ni guiones: "coca cola", "Coca-Cola" y "cocacola" son lo mismo.
function clave(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function carta(clase) {
    return clase === 'bebida' ? BEBIDAS : PINCHOS;
}

const CATALOGO = {
    bebidas: BEBIDAS,
    pinchos: PINCHOS,
    compra: COMPRA,
    avisarCompraA: AVISAR_COMPRA_A,
    horaAviso: HORA_AVISO,
    maxLongitudOtro: MAX_LONGITUD_OTRO,
    maxItems: MAX_ITEMS,
    maxCantidad: MAX_CANTIDAD,

    clave,

    // Lista de un apartado ('bebida' o 'pincho')
    carta,

    // Busca en la carta lo escrito a mano en "Otro". Vale el nombre corto
    // ("Solo"), el que se lee en pantalla ("Café Solo") y los de ALIAS.
    // Devuelve { clase, nombre } o null si no está. Mira en los dos
    // apartados: quien escribe "croissant" entre las bebidas quiere el
    // croissant de los pinchos.
    buscar(texto) {
        const buscada = clave(texto);
        if (!buscada) return null;

        const alias = Object.keys(ALIAS).find(otra => clave(otra) === buscada);
        const objetivo = alias ? clave(ALIAS[alias]) : buscada;

        for (const clase of ['bebida', 'pincho']) {
            const nombre = carta(clase).find(n =>
                clave(n) === objetivo || (ETIQUETAS[n] && clave(ETIQUETAS[n]) === objetivo));
            if (nombre) return { clase, nombre };
        }
        return null;
    },

    // El hielo solo se ofrece en los cafés de la carta, y la plancha en lo de
    // A_LA_PLANCHA. En "Otro" ninguno de los dos: no se sabe qué es. Lo usan
    // la pantalla (para enseñar el botón) y el servidor (para no fiarse de lo
    // que llegue).
    admiteHielo(clase, nombre) {
        return clase === 'bebida' && CAFES.includes(nombre);
    },

    admitePlancha(clase, nombre) {
        return clase === 'pincho' && A_LA_PLANCHA.includes(nombre);
    },

    // La cantidad de una cosa: entera, entre 1 y MAX_CANTIDAD. Lo que no se
    // entienda cuenta como 1, así valen también los pedidos de antes, que no
    // la traían.
    cantidad(valor) {
        const numero = Math.floor(Number(valor));
        if (!Number.isFinite(numero)) return 1;
        return Math.min(MAX_CANTIDAD, Math.max(1, numero));
    },

    // Lo que identifica una línea del pedido: dos cosas con la misma clave son
    // la misma y se suman en vez de salir dos veces.
    claveLinea(clase, nombre) {
        return `${clase}|${clave(nombre) || String(nombre).toLowerCase()}`;
    },

    // Deja un pedido limpio. Admite lo que hay en la carta o, para "Otro",
    // cualquier texto corto, y descarta el resto. Lo escrito a mano que ya
    // está en la carta cuenta como lo de la carta ("croissant" es el
    // Croissant) y lo repetido se junta en una sola línea sumando las
    // cantidades. Las bebidas van delante de los pinchos, que es como se lee.
    // Lo usan el servidor (para no fiarse de lo que llega) y la pantalla (para
    // cargar un pedido guardado o el de la última vez).
    normalizarPedido(items) {
        if (!Array.isArray(items)) return [];

        const lineas = new Map();

        for (const item of items) {
            if (!item || (item.clase !== 'bebida' && item.clase !== 'pincho')) continue;

            const escrito = String(item.nombre || '').trim();
            if (!escrito || escrito.length > MAX_LONGITUD_OTRO) continue;

            const { clase, nombre } = CATALOGO.buscar(escrito) || { clase: item.clase, nombre: escrito };
            const claveLinea = CATALOGO.claveLinea(clase, nombre);

            // El hielo solo vale en los cafés de la carta y la plancha en lo
            // que la admite, venga lo que venga
            const hielo = CATALOGO.admiteHielo(clase, nombre) && Boolean(item.hielo);
            const plancha = CATALOGO.admitePlancha(clase, nombre) && Boolean(item.plancha);
            const cantidad = CATALOGO.cantidad(item.cantidad);

            const previa = lineas.get(claveLinea);
            if (previa) {
                previa.cantidad = CATALOGO.cantidad(previa.cantidad + cantidad);
                previa.hielo = previa.hielo || hielo;
                previa.plancha = previa.plancha || plancha;
                continue;
            }

            if (lineas.size >= MAX_ITEMS) continue;
            lineas.set(claveLinea, { clase, nombre, cantidad, hielo, plancha });
        }

        const todas = [...lineas.values()];
        return [
            ...todas.filter(item => item.clase === 'bebida'),
            ...todas.filter(item => item.clase === 'pincho'),
        ];
    },

    etiqueta(nombre) {
        return ETIQUETAS[nombre] || nombre;
    },

    icono(nombre, porDefecto) {
        return ICONOS[nombre] || porDefecto;
    },

    // Cómo se lee una cosa pedida: "Café con Leche con hielo x2",
    // "Croissant a la plancha". La cantidad solo se dice si es más de una.
    describir(item) {
        let texto = CATALOGO.etiqueta(item.nombre);
        if (item.hielo) texto += ' con hielo';
        if (item.plancha) texto += ' a la plancha';
        const cantidad = CATALOGO.cantidad(item.cantidad);
        if (cantidad > 1) texto += ` x${cantidad}`;
        return texto;
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CATALOGO;
}
