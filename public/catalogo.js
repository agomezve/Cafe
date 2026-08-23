// Catálogo de bares, bebidas y pinchos.
//
// Este archivo lo cargan las dos partes: el navegador con
// <script src="catalogo.js"> (deja `CATALOGO` como global) y el servidor con
// require('./public/catalogo'). Así la lista que se pinta en la pantalla y la
// que valida el servidor son literalmente la misma, y añadir un bar nuevo es
// tocar solo aquí.

const BEBIDAS_BASE = ['Solo', 'Con Leche', 'Cortado', 'Descafeinado', 'Mosto'];

const PINCHOS_BASE = [
    'Patatas', 'Jeta', 'Gulas', 'Huevos rotos',
    'Lasaña', 'Tortilla', 'Bocadillo', 'Gambas rebozadas',
];

const sin = (lista, ...fuera) => lista.filter(nombre => !fuera.includes(nombre));

// De momento todos los bares tienen la misma carta salvo sus rarezas. Cuando
// se añadan más bares, basta con meterlos en esta lista.
const BARES = [
    {
        id: 'verssache',
        nombre: 'Verssache',
        bebidas: BEBIDAS_BASE,
        pinchos: [...sin(PINCHOS_BASE, 'Gambas rebozadas'), 'Sandwich'],
    },
    {
        id: 'petit-prince',
        nombre: 'Petit Prince',
        bebidas: BEBIDAS_BASE,
        pinchos: sin(PINCHOS_BASE, 'Lasaña'),
    },
];

// Lo que se lee en pantalla cuando el nombre corto se queda escueto
const ETIQUETAS = {
    'Solo': 'Café Solo',
    'Con Leche': 'Café con Leche',
};

const ICONOS = {
    'Solo': '☕', 'Con Leche': '🥛', 'Cortado': '🤏', 'Descafeinado': '🌙', 'Mosto': '🍇',
    'Patatas': '🥔', 'Jeta': '🐷', 'Gulas': '🍜', 'Huevos rotos': '🍳',
    'Lasaña': '🍝', 'Tortilla': '🥚', 'Bocadillo': '🥪', 'Gambas rebozadas': '🍤',
    'Sandwich': '🍞',
};

// Texto libre de la opción "Otro": corto, que esto acaba en una lista para leer
// en voz alta en la barra.
const MAX_LONGITUD_OTRO = 40;

// Tope de cosas por pedido. Se puede pedir más de una bebida y más de un
// pincho, pero tampoco cien.
const MAX_ITEMS = 12;

const CATALOGO = {
    bares: BARES,
    maxLongitudOtro: MAX_LONGITUD_OTRO,
    maxItems: MAX_ITEMS,

    barPorId(id) {
        return BARES.find(bar => bar.id === String(id || '')) || null;
    },

    // Lista del bar para un apartado ('bebida' o 'pincho')
    carta(bar, clase) {
        return clase === 'bebida' ? bar.bebidas : bar.pinchos;
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
