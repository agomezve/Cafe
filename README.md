# Cafendo · SLCLAB

Web app para apuntar el café y el pincho de los del laboratorio y ver el
resumen del turno.
Pensada para instalarse como app en el móvil (iOS y Android) y para desplegarse
en Vercel con la base de datos en la nube (Postgres), así funciona fuera de la
oficina y sin depender de que un ordenador esté encendido.

## Cómo funciona

1. **Login**: cada persona entra solo con su nombre, sin contraseña. El
   servidor devuelve un token firmado que se guarda en el móvil, así no hay
   que volver a entrar cada día (dura 30 días).
2. **Elegir bar**: la primera pantalla es "Elige bar:" con los bares a los que
   baja el laboratorio (ahora mismo **Verssache** y **Petit Prince**). Cada bar
   tiene su carta, y el resumen y las preferencias van por bar.
3. **Elegir qué se pide**: la pantalla tiene dos apartados y se puede marcar
   **varias cosas de cada uno** (dos cafés y tres pinchos, si hace falta), o
   solo de uno: nada es obligatorio mientras se pida algo.
   - **Cafés y bebidas**: Solo, Con Leche, Cortado, Descafeinado y Mosto, cada
     uno con su casilla de hielo al marcarlo, u "Otro" escribiendo a mano lo
     que sea (una Coca-Cola, un té...). En "Otro" no se pregunta por el hielo.
   - **Pinchos**: los de la carta del bar y "Otro" a mano.
   Si esa persona ya pidió otro día **en ese bar**, arriba le sale un aviso con
   lo que pidió la última vez y dos botones: repetirlo tal cual o elegir otra
   cosa. Lo que se pidió en el otro bar no se mezcla.
4. **Guardar**: un pedido por persona y bar mientras dure el turno. Si alguien
   lo repite, el servidor lo rechaza y le dice cuántos minutos quedan (y aunque
   se dé doble toque a la vez desde el móvil, la base de datos solo deja
   pasar uno).
5. **Los pedidos caducan a los 25 minutos**: se borran solos de la base de
   datos, así el segundo turno abre el resumen y lo ve limpio, sin los cafés
   de la ronda anterior, y quien ya pidió puede volver a pedir. No hace falta
   que nadie borre nada a mano ni que haya un proceso corriendo de fondo: la
   limpieza se hace al pedir y al mirar el resumen.
6. **Resumen**: totales por bebida, por pincho, vasos con hielo y quién
   ha pedido qué, solo del turno en curso y solo del bar elegido. El botón "Finalizar Turno" lo vacía a mano
   por si se quiere arrancar la siguiente ronda sin esperar los 25 minutos.

## Arrancar en local

```bash
npm install
npm run dev
```

Abre <http://localhost:3000>. No hace falta ninguna cuenta ni variable de
entorno: si no hay `DATABASE_URL`, la app usa un Postgres embebido que se
guarda en `data/` (carpeta que no se sube al repositorio).

## Estilos (Tailwind CSS)

Los estilos se escriben en `src/estilos.css` (Tailwind v4) y se compilan a
`public/estilos.css`, que es el archivo que sirve la app y el que se sube al
repositorio. Si tocas clases en el HTML/JS o el propio `src/estilos.css`,
recompila:

```bash
npm run build:css
```

O déjalo recompilando solo mientras trabajas:

```bash
npm run watch:css
```

La paleta (café, crema, verde…) vive en el bloque `@theme` de
`src/estilos.css`, y las piezas que se repiten en las cuatro pantallas
(`.tarjeta`, `.boton`, `.campo`, `.opcion`) están en `@layer components`.

## Desplegarlo en Vercel (para que lo use todo el equipo)

Necesitas tener [Vercel CLI](https://vercel.com/docs/cli) (se puede usar sin
instalar nada, con `npx`) y una cuenta de Vercel.

1. **Entrar con tu cuenta** (abre el navegador para confirmar):

   ```bash
   npx vercel login
   ```

2. **Desplegar** desde la carpeta del proyecto:

   ```bash
   npx vercel
   ```

   La primera vez te pregunta el nombre del proyecto y confirma la carpeta;
   acepta los valores por defecto. Al terminar te da una URL de vista previa.

3. **Conectar una base de datos Postgres** (para que los pedidos se guarden
   de verdad, no en el disco de la función):
   - Ve a [vercel.com/dashboard](https://vercel.com/dashboard) → tu proyecto
     → pestaña **Storage** → **Create Database** → elige **Postgres** (Neon
     o Supabase, cualquiera del marketplace vale) → **Connect** al proyecto.
   - Vercel inyecta sola la variable `DATABASE_URL` (o `POSTGRES_URL`), no
     hay que copiar ninguna contraseña a mano.

4. **Añadir el secreto de sesión** (Settings → Environment Variables del
   proyecto en el dashboard), variable `SESSION_SECRET`. Para generarlo:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

5. **Desplegar a producción** para que tome las variables nuevas:

   ```bash
   npx vercel --prod
   ```

   Esto imprime la URL final (algo como `https://cafendo.vercel.app`).
   Esa es la que le pasas a tus compañeros.

## Que lo instalen en el móvil

Cada uno abre el enlace en Chrome (Android) o Safari (iPhone) y:

- **Android/Chrome**: menú (⋮) → **Instalar app** / **Añadir a pantalla de inicio**.
- **iPhone/Safari**: botón Compartir → **Añadir a pantalla de inicio**.

Queda como un icono más, a pantalla completa, sin barra del navegador.

## Estructura

```
cafendo/
├── server.js              app Express (login, pedidos, resumen)
├── db.js                  esquema y consultas (Postgres en la nube o local)
├── api/index.js           punto de entrada para Vercel (funciones serverless)
├── vercel.json             enruta todas las peticiones a api/index.js
├── scripts/gen-icons.js    regenera los iconos si cambia el logo (usa "sharp")
├── src/estilos.css         fuente de Tailwind (se compila a public/estilos.css)
└── public/
    ├── index.html          login (solo el nombre)
    ├── bares.html           "Elige bar:"
    ├── app.html              pantalla del pedido
    ├── resumen.html           resumen del turno de ese bar
    ├── catalogo.js             bares, bebidas y pinchos (lo usan navegador Y servidor)
    ├── estilos.css             CSS compilado por Tailwind (no editar a mano)
    ├── auth.js                 sesión, bar elegido, fetch autenticado y service worker
    ├── acceso.js, bares.js, app.js, resumen.js
    ├── sw.js                  caché para que cargue rápido e instalable
    ├── manifest.webmanifest
    └── icons/
```

## Base de datos

Tablas `usuarios (id, nombre)`, `pedidos (id, usuario, bar, creado_en)` y
`pedido_items (id, pedido_id, clase, nombre, hielo)`. El pedido en sí solo dice
quién y en qué bar; lo que se pide va en `pedido_items`, una fila por bebida o
pincho, que es lo que permite pedir varias cosas. Hay un índice único por
`(usuario, bar)` — eso es lo que impide pedidos duplicados en el mismo turno,
incluso si dos peticiones llegan a la vez. Como los pedidos se borran al
caducar, esa misma restricción deja pedir otra vez en el turno siguiente.

En esas tablas solo vive el turno actual: no se guarda histórico de lo que pidió
cada uno. Aparte hay dos tablas que no caducan:

- `preferencias_bar (usuario, bar, items, actualizado_en)`: lo último que pidió
  cada persona **en cada bar** (los items, en JSON), para ofrecérselo cuando
  vuelve otro día a ese mismo bar.
- `ajustes (clave, valor)`: guarda el secreto que firma las sesiones. Es
  importante que sea el mismo en todas las instancias: en Vercel cada petición
  puede caer en una función distinta y, si cada una se inventa el suyo, el
  token del login lo rechaza la siguiente y te echa de la sesión a media
  faena. Si defines `SESSION_SECRET` manda esa y la tabla no se usa.

## Cosas que querrás tocar

- **Duración del turno**: variable de entorno `MINUTOS_TURNO` (por defecto
  `25`). En Vercel se pone en Settings → Environment Variables.
- **Altas y bajas de gente**: la lista `USUARIOS_INICIALES` de `db.js`. Solo
  se usa para crear usuarios la primera vez; si ya existen no se tocan.
- **Bares, bebidas y pinchos**: todo sale de `public/catalogo.js`. Para añadir
  un bar nuevo basta con meterlo en la lista `BARES` (con su `id`, su nombre y
  su carta); la pantalla de elegir bar y la del pedido se pintan solas, y el
  servidor valida contra esa misma lista.

## Seguridad

El login solo comprueba que el nombre esté en la lista del laboratorio y firma
un token (HMAC-SHA256) que hace falta para pedir café o ver el resumen. No hay
contraseña a propósito: aquí no se guarda nada sensible, esto sirve para saber
quién quiere cortado, y cualquiera del equipo puede apuntar a otro (que es lo
que pasa igual cuando bajas tú a por los cafés). Vercel sirve la app por HTTPS
automáticamente.
