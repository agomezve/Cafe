# Turno del café · SLCLAB

Web app para apuntar el café de los del laboratorio y ver el resumen del turno.
Pensada para instalarse como app en el móvil (iOS y Android) y para desplegarse
en Vercel con la base de datos en la nube (Postgres), así funciona fuera de la
oficina y sin depender de que un ordenador esté encendido.

## Cómo funciona

1. **Login**: cada persona entra con su nombre y la contraseña común. El
   servidor devuelve un token firmado que se guarda en el móvil, así no hay
   que volver a entrar cada día (dura 30 días).
2. **Elegir café**: Solo, Con Leche o Cortado (con opción de hielo), u "Otro"
   escribiendo a mano lo que sea (una Coca-Cola, un té...). En "Otro" no se
   pregunta por el hielo.
3. **Guardar**: un pedido por persona mientras dure el turno. Si alguien lo
   repite, el servidor lo rechaza y le dice cuántos minutos quedan (y aunque
   se dé doble toque a la vez desde el móvil, la base de datos solo deja
   pasar uno).
4. **Los pedidos caducan a los 25 minutos**: se borran solos de la base de
   datos, así el segundo turno abre el resumen y lo ve limpio, sin los cafés
   de la ronda anterior, y quien ya pidió puede volver a pedir. No hace falta
   que nadie borre nada a mano ni que haya un proceso corriendo de fondo: la
   limpieza se hace al pedir y al mirar el resumen.
5. **Resumen**: totales por tipo de café, vasos con hielo y quién ha pedido
   qué, solo del turno en curso. El botón "Finalizar Turno" lo vacía a mano
   por si se quiere arrancar la siguiente ronda sin esperar los 25 minutos.

## Arrancar en local

```bash
npm install
npm run dev
```

Abre <http://localhost:3000>. No hace falta ninguna cuenta ni variable de
entorno: si no hay `DATABASE_URL`, la app usa un Postgres embebido que se
guarda en `data/` (carpeta que no se sube al repositorio).

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

   Esto imprime la URL final (algo como `https://turno-cafe-slclab.vercel.app`).
   Esa es la que le pasas a tus compañeros.

## Que lo instalen en el móvil

Cada uno abre el enlace en Chrome (Android) o Safari (iPhone) y:

- **Android/Chrome**: menú (⋮) → **Instalar app** / **Añadir a pantalla de inicio**.
- **iPhone/Safari**: botón Compartir → **Añadir a pantalla de inicio**.

Queda como un icono más, a pantalla completa, sin barra del navegador.

## Estructura

```
turno-cafe/
├── server.js              app Express (login, pedidos, resumen)
├── db.js                  esquema y consultas (Postgres en la nube o local)
├── api/index.js           punto de entrada para Vercel (funciones serverless)
├── vercel.json             enruta todas las peticiones a api/index.js
├── scripts/gen-icons.js    regenera los iconos si cambia el logo (usa "sharp")
└── public/
    ├── index.html          login
    ├── app.html             pantalla del pedido
    ├── resumen.html          resumen del turno
    ├── auth.js               sesión, fetch autenticado y registro del service worker
    ├── acceso.js, app.js, resumen.js
    ├── sw.js                  caché para que cargue rápido e instalable
    ├── manifest.webmanifest
    └── icons/
```

## Base de datos

Tablas `usuarios (id, nombre, password)` y
`pedidos (id, usuario, tipo_cafe, hielo, creado_en)`, con un índice único por
`usuario` — eso es lo que impide pedidos duplicados en el mismo turno, incluso
si dos peticiones llegan a la vez. Como los pedidos se borran al caducar, esa
misma restricción deja pedir otra vez en el turno siguiente.

En la tabla solo vive el turno actual: no se guarda histórico de lo que pidió
cada uno.

## Cosas que querrás tocar

- **Duración del turno**: variable de entorno `MINUTOS_TURNO` (por defecto
  `25`). En Vercel se pone en Settings → Environment Variables.
- **Altas y bajas de gente**: la lista `USUARIOS_INICIALES` de `db.js`. Solo
  se usa para crear usuarios la primera vez; si ya existen no se tocan.
- **Contraseña inicial**: variable de entorno `CAFE_PASSWORD_INICIAL`
  (por defecto `labAlfa21`). Cambiar la contraseña de alguien ya creado se
  hace directamente en la tabla `usuarios`.
- **Más opciones de café fijas**: añade el valor al `Set TIPOS_FIJOS` de
  `server.js` y un `<label>` más en `app.html`.

## Seguridad

El login compara usuario/contraseña contra la base de datos y firma un token
(HMAC-SHA256) que hace falta para pedir café o ver el resumen — ya no basta
con saber el nombre de un compañero para pedir en su lugar. Aun así la
contraseña es la misma para todo el equipo: vale para saber quién quiere
cortado, no para nada sensible. Vercel sirve la app por HTTPS automáticamente.
