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
};

// Texto libre de la opción "Otro": corto, que esto acaba en una lista para leer
// en voz alta en la barra.
const MAX_LONGITUD_OTRO = 40;

// Tope de cosas por pedido. Se puede pedir más de una bebida y más de un
// pincho, pero tampoco cien.
const MAX_ITEMS = 12;

const CATALOGO = {
    bebidas: BEBIDAS,
    pinchos: PINCHOS,
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
