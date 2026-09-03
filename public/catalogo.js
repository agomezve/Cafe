// Catálogo de bebidas y pinchos.
//
// Este archivo lo cargan las dos partes: el navegador con
// <script src="catalogo.js"> (deja `CATALOGO` como global) y el servidor con
// require('./public/catalogo'). Así la lista que se pinta en la pantalla y la
// que valida el servidor son literalmente la misma, y añadir algo a la carta
// es tocar solo aquí.

// Solo los cafés admiten hielo: al Mosto y al Colacao no se les pregunta
const CAFES = ['Solo', 'Con Leche', 'Cortado', 'Descafeinado'];

const BEBIDAS = [...CAFES, 'Mosto', 'Colacao'];

// Todos los pinchos juntos, sin repetir: ya no se elige bar, así que la carta
// es la suma de lo que había en cada uno.
const PINCHOS = [
    'Patatas', 'Jeta', 'Gulas', 'Huevos rotos',
    'Lasaña', 'Tortilla', 'Bocadillo', 'Gambas rebozadas',
    'Sandwich', 'Empanadilla', 'Croissant', 'Rabas', 'Bacalao',
];

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
    'Mosto': '🍇', 'Colacao': '🍫',
    'Patatas': '🥔', 'Jeta': '🐷', 'Gulas': '🍜', 'Huevos rotos': '🍳',
    'Lasaña': '🍝', 'Tortilla': '🥚', 'Bocadillo': '🥪', 'Gambas rebozadas': '🍤',
    'Sandwich': '🍞', 'Empanadilla': '🥟', 'Croissant': '🥐', 'Rabas': '🦑',
    'Bacalao': '🐟',
    'Café': '☕', 'Ambientador': '🌸', 'Rollos Cocina': '🧻', 'Papel Higiénico': '🚻',
    'Vasos': '🥤', 'Cucharas': '🥄', 'Galletas': '🍪', 'Fairy': '🧴',
    'Jabón manos': '🧼', 'Cola-Cao': '🍫', 'Leche': '🥛', 'Sacarina': '🍬',
    'Azúcar': '🧂',
};

// Texto libre de la opción "Otro": corto, que esto acaba en una lista para leer
// en voz alta en la barra.
const MAX_LONGITUD_OTRO = 40;

// Tope de cosas por pedido. Se puede pedir más de una bebida y más de un
// pincho, pero tampoco cien.
const MAX_ITEMS = 12;

// Hora a la que se manda el aviso diario. Solo es el texto que se lee en la
// app y en la notificación: quien dispara de verdad a esa hora es el servicio
// de cron externo, así que si se cambia aquí hay que cambiarlo también allí.
const HORA_AVISO = '10:30';

const CATALOGO = {
    bebidas: BEBIDAS,
    pinchos: PINCHOS,
    compra: COMPRA,
    avisarCompraA: AVISAR_COMPRA_A,
    horaAviso: HORA_AVISO,
    maxLongitudOtro: MAX_LONGITUD_OTRO,
    maxItems: MAX_ITEMS,

    // Lista de un apartado ('bebida' o 'pincho')
    carta(clase) {
        return clase === 'bebida' ? BEBIDAS : PINCHOS;
    },

    // El hielo solo se ofrece en los cafés de la carta. En "Otro" tampoco: no
    // se sabe qué es. Lo usan la pantalla (para enseñar la casilla) y el
    // servidor (para no fiarse de lo que llegue).
    admiteHielo(clase, nombre) {
        return clase === 'bebida' && CAFES.includes(nombre);
    },

    etiqueta(nombre) {
        return ETIQUETAS[nombre] || nombre;
    },

    icono(nombre, porDefecto) {
        return ICONOS[nombre] || porDefecto;
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CATALOGO;
}
