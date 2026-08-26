# Cafendo · SLCLAB

Web app para apuntar el café y el pincho de los del laboratorio y ver el
resumen del turno.
Pensada para instalarse como app en el móvil (iOS y Android) y para desplegarse
en Vercel con la base de datos en la nube (Postgres), así funciona fuera de la
oficina y sin depender de que un ordenador esté encendido.

## Cómo funciona

1. **Login**: cada persona entra solo con su nombre, sin contraseña. El
   servidor devuelve un token firmado que se guarda en el móvil, así no hay
   que volver a entrar cada día (dura 30 días). El nombre se queda guardado
   aunque cierres sesión: la próxima vez el campo sale ya escrito y basta con
   darle a "Entrar" (si entra otra persona, lo borra y pone el suyo).
2. **Elegir qué se pide**: nada más entrar sale la pantalla del pedido, con dos
   apartados. Se puede marcar **varias cosas de cada uno** (dos cafés y tres
   pinchos, si hace falta), o solo de uno: nada es obligatorio mientras se pida
   algo.
   - **Cafés y bebidas**: Solo, Con Leche, Cortado, Descafeinado, Mosto y
     Colacao, u "Otro" escribiendo a mano lo que sea (una Coca-Cola, un té...).
     La casilla de hielo sale **solo en los cafés** al marcarlos: al Mosto, al
     Colacao y a "Otro" no se les pregunta.
   - **Pinchos**: Patatas, Jeta, Gulas, Huevos rotos, Lasaña, Tortilla,
     Bocadillo, Gambas rebozadas, Sandwich, Empanadilla, Croissant, Rabas y
     Bacalao, más "Otro" a mano.
   Si esa persona ya pidió otro día, arriba le sale un aviso con lo que pidió
   la última vez y dos botones: repetirlo tal cual o elegir otra cosa.
3. **Guardar**: un pedido por persona mientras dure el turno (aunque se dé
   doble toque a la vez desde el móvil, la base de datos solo deja pasar uno).
4. **Cambiar de idea**: quien ya ha pedido ve arriba lo que tiene pedido, y la
   pantalla sale con sus cosas ya marcadas. A partir de ahí puede:
   - **Modificar el pedido** las veces que quiera: se marca o desmarca lo que
     sea y el botón (que ahora pone "Modificar pedido") lo reemplaza. Cambiarlo
     **no alarga el turno**: sigue caducando a la hora del pedido original, así
     que no sirve para colarse en la ronda siguiente.
   - **Anular el pedido** y volver a pedir de cero cuando quiera, sin esperar a
     que caduque. Las casillas se quedan como estaban, así que si ha sido sin
     querer basta con darle otra vez a "Guardar Pedido".
5. **Los pedidos caducan a los 25 minutos**: se borran solos de la base de
   datos, así el segundo turno abre el resumen y lo ve limpio, sin los cafés
   de la ronda anterior, y quien ya pidió puede volver a pedir. No hace falta
   que nadie borre nada a mano ni que haya un proceso corriendo de fondo: la
   limpieza se hace al pedir y al mirar el resumen.
6. **Resumen**: totales por bebida, por pincho, vasos con hielo y quién ha
   pedido qué, solo del turno en curso. Se refresca solo cada 30 segundos, así
   que las modificaciones de última hora se ven sin recargar. El botón
   "Finalizar Turno" lo vacía a mano por si se quiere arrancar la siguiente
   ronda sin esperar los 25 minutos.

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
   proyecto en el dashboard), variable `SESSION_SECRET`. Se genera con:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Lo demás no hay que configurarlo: las claves de los avisos (VAPID) y la
   contraseña del cron se generan solas la primera vez y se guardan en la base
   de datos.

5. **Desplegar a producción** para que tome las variables nuevas:

   ```bash
   npx vercel --prod
   ```

   Esto imprime la URL final (algo como `https://cafendo.vercel.app`).
   Esa es la que le pasas a tus compañeros.

## El aviso diario de las 10:30

Cada mañana les llega **Cafendo · ¿Qué quieres hoy?** a quienes lo hayan
activado, y al tocarlo se abre la pantalla del pedido.

El móvil no puede programarse el aviso solo: no existe forma fiable de hacerlo
en web. Lo manda el servidor a esa hora, así que hace falta algo que llame a
`/api/avisar` puntualmente.

**No sirve el cron de Vercel**: en el plan gratuito
[solo garantiza la hora, no el minuto](https://vercel.com/docs/cron-jobs/usage-and-pricing)
— pones las 10:30 y te salta en cualquier momento entre las 10:00 y las 10:59.
Hay que usar un servicio de cron externo (cron-job.org y similares tienen plan
gratuito con precisión de minuto).

Los datos exactos que hay que meterle te los da la propia app. Entra con tu
nombre y pide la configuración:

```bash
curl.exe -s -X POST https://TU-APP.vercel.app/api/login -H "Content-Type: application/json" -d "{\"usuario\":\"Aaron\"}"
```

Con el `token` que devuelve:

```bash
curl.exe -s https://TU-APP.vercel.app/api/avisar/config -H "Authorization: Bearer EL_TOKEN_DE_ARRIBA"
```

Y te responde la URL, el método, la cabecera y el horario ya montados para
copiar y pegar en el servicio de cron.

No hace falta configurar nada en Vercel: si no existe la variable de entorno
`CRON_TOKEN`, el servidor genera una contraseña la primera vez y la guarda en
la base de datos. Ponerla como variable de entorno sigue funcionando y manda
sobre la de la base de datos, por si prefieres tenerla ahí.

El token va en la cabecera y no en la URL a propósito: las URLs acaban en los
registros de todo el mundo. Y la ruta tiene un freno de un aviso por minuto,
para que un cron mal configurado (o alguien con el token) no pueda freír a
notificaciones al laboratorio.

La respuesta dice qué pasó: `{"enviados":12,"caducadas":1,"fallidos":0,...}`.
Si fallan todos, devuelve un error 500 para que el servicio de cron te avise en
vez de dar por buena una mañana sin avisos.

## Que lo instalen en el móvil

Cada uno abre el enlace en Chrome (Android) o Safari (iPhone) y:

- **Android/Chrome**: menú (⋮) → **Instalar app** / **Añadir a pantalla de inicio**.
- **iPhone/Safari**: botón Compartir → **Añadir a pantalla de inicio**.

Luego, dentro de la app, sale una vez el botón **"🔔 Avísame todos los días a
las 10:30"**: se pulsa, se acepta el permiso del móvil y listo, no hay que
volver a tocar nada.

Dos avisos sobre esto:

- **En iPhone el icono es obligatorio.** Desde una pestaña de Safari los avisos
  no llegan, es cosa de Apple. Si alguien abre Cafendo desde Safari, la propia
  app le explica los dos toques que le faltan.
- **El permiso no se puede saltar** en ningún móvil: siempre hay que aceptarlo
  una vez. Las apps normales funcionan igual.

Quien se arrepienta tiene un "Quitar avisos" al final de la pantalla.

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
    ├── app.html             pantalla del pedido
    ├── resumen.html          resumen del turno
    ├── catalogo.js            bebidas y pinchos (lo usan navegador Y servidor)
    ├── estilos.css            CSS compilado por Tailwind (no editar a mano)
    ├── auth.js                sesión, fetch autenticado y service worker
    ├── avisos.js              el botón de "avísame a las 10:30"
    ├── acceso.js, app.js, resumen.js
    ├── sw.js                  caché para que cargue rápido e instalable
    ├── manifest.webmanifest
    └── icons/
```

## Base de datos

Tablas `usuarios (id, nombre)`, `pedidos (id, usuario, creado_en)` y
`pedido_items (id, pedido_id, clase, nombre, hielo)`. El pedido en sí solo dice
quién y cuándo; lo que se pide va en `pedido_items`, una fila por bebida o
pincho, que es lo que permite pedir varias cosas. Hay un índice único por
`usuario` — eso es lo que impide pedidos duplicados en el mismo turno, incluso
si dos peticiones llegan a la vez. Como los pedidos se borran al caducar, esa
misma restricción deja pedir otra vez en el turno siguiente.

En esas tablas solo vive el turno actual: no se guarda histórico de lo que pidió
cada uno. Aparte hay dos tablas que no caducan:

- `preferencias_usuario (usuario, items, actualizado_en)`: lo último que pidió
  cada persona (los items, en JSON), para ofrecérselo cuando vuelve otro día.
- `suscripciones (endpoint, usuario, p256dh, auth, creado_en)`: los móviles que
  han dicho "avísame". La clave es el endpoint que da el navegador, así que
  quien use dos aparatos recibe el aviso en los dos. Las que el servicio de
  push rechaza por muertas se borran solas en el envío diario.
- `ajustes (clave, valor)`: guarda el secreto que firma las sesiones. Es
  importante que sea el mismo en todas las instancias: en Vercel cada petición
  puede caer en una función distinta y, si cada una se inventa el suyo, el
  token del login lo rechaza la siguiente y te echa de la sesión a media
  faena. Si defines `SESSION_SECRET` manda esa y la tabla no se usa.

## Cosas que querrás tocar

- **Duración del turno**: variable de entorno `MINUTOS_TURNO` (por defecto
  `25`). En Vercel se pone en Settings → Environment Variables.
- **Hora del aviso**: se cambia en el servicio de cron externo, no en el
  código. Si cambias la hora, retoca también el texto `HORA_AVISO` de
  `public/avisos.js`, que es lo que se lee en el botón.
- **Altas y bajas de gente**: la lista `USUARIOS_INICIALES` de `db.js`. Solo
  se usa para crear usuarios la primera vez; si ya existen no se tocan.
- **Bebidas y pinchos**: la carta sale de `public/catalogo.js`. Se añade el
  nombre a la lista `BEBIDAS` o `PINCHOS` (y su emoji en `ICONOS`, opcional);
  la pantalla del pedido se pinta sola y el servidor valida contra esa misma
  lista. Si lo nuevo es un café que puede pedirse con hielo, va en `CAFES`.

## Seguridad

El login solo comprueba que el nombre esté en la lista del laboratorio y firma
un token (HMAC-SHA256) que hace falta para pedir café o ver el resumen. No hay
contraseña a propósito: aquí no se guarda nada sensible, esto sirve para saber
quién quiere cortado, y cualquiera del equipo puede apuntar a otro (que es lo
que pasa igual cuando bajas tú a por los cafés). Vercel sirve la app por HTTPS
automáticamente.
