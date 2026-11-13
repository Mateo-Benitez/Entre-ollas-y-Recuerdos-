# Entre ollas y recuerdos — tienda online de viandas caseras

Tienda web para un emprendimiento de viandas: los clientes ven el menú semanal, arman su carrito y envían el pedido por **WhatsApp** con todo el detalle y el total. El dueño administra viandas, menús semanales, precios, disponibilidad y datos del negocio desde un **panel privado**, sin tocar código.

- **Tienda:** `http://tu-dominio/`
- **Panel:** `http://tu-dominio/admin`

## Tecnologías

| Parte | Qué usa |
|---|---|
| Servidor | Node.js 20+ con Express 5 |
| Base de datos | SQLite (archivo `data/viandas.db`, sin instalar nada aparte) |
| Fotos | Se optimizan automáticamente a WEBP con `sharp` (`data/uploads/`) |
| Frontend | HTML, CSS y JavaScript sin frameworks ni compilación |
| Seguridad | Contraseñas con bcrypt, sesiones con cookie `HttpOnly`, protección CSRF, límite de intentos de login, cabeceras con Helmet |

## Instalación

```bash
npm install
npm run create-admin        # crea el usuario del dueño (pide usuario y contraseña)
npm start                   # http://localhost:3000
```

Opcional, para probar con datos de ejemplo (solo si la base está vacía):

```bash
npm run seed:demo
```

Para desarrollo con reinicio automático: `npm run dev`. Para correr las pruebas: `npm test`.

## Primeros pasos en el panel

1. **Configuración → WhatsApp:** cargá el número que recibe los pedidos, con código de país y sin signos. En Argentina: `54 9` + característica sin 0 + número sin 15. Ejemplo: 11 1234-5678 → `5491112345678`. Tocá **Probar número** para verificarlo. Mientras no haya número, la tienda no deja enviar pedidos (no hay ningún número inventado en el código).
2. **Configuración → Negocio:** nombre, frase de bienvenida, presentación, logo y foto de portada.
3. **Configuración → Horarios, Entregas y Zonas:** horarios por día, envío y/o retiro, costo por zona, pedido mínimo y formas de pago.
4. **Categorías y Viandas:** cargá tus platos con foto, precio, descripción e ingredientes.
5. **Menú semanal:** creá el menú y marcá en la grilla qué vianda se ofrece cada día (o "Todos" para cualquier día).

## Cómo funciona el menú semanal

- Cada menú tiene un rango de fechas opcional y un interruptor **Activo**.
- La tienda muestra el menú activo cuyas fechas incluyen el día de hoy. Si hay varios, gana el que empieza más tarde.
- **Programar:** creá el menú de la semana próxima activo con fecha desde el lunes, y aparece solo ese día.
- **Rápido:** el botón **Semana próxima** (o **Duplicar**) copia el menú actual con las fechas corridas una semana; después solo cambiás lo necesario.
- Marcar una vianda como **agotada** se refleja al instante en la tienda y no se puede pedir.

## Cómo se arma el pedido

1. El cliente agrega viandas (por día o por categoría). El carrito se guarda en su navegador mientras navega.
2. Completa nombre, forma de entrega (envío con zona y dirección, o retiro), forma de pago y observaciones.
3. El **servidor** vuelve a validar todo contra la base de datos (productos del menú vigente, disponibilidad, cantidades, zona) y calcula los importes; los precios que mande el navegador no se usan.
4. El cliente revisa el resumen y toca **Finalizar pedido por WhatsApp**: se abre `wa.me` con el mensaje listo, por ejemplo:

```
¡Hola! Quiero realizar el siguiente pedido:

*Lunes*
2x Milanesa con puré - $19.000

*Para cualquier día*
1x Flan casero con dulce de leche - $3.200

Subtotal: $22.200
Envío (Centro): $1.000
*Total: $23.200*

Nombre: Ana
Forma de entrega: Envío a domicilio
Dirección: Calle 123 (Centro)
Forma de pago: Efectivo
Observaciones: timbre 2

Pedido N° DD4E25
¡Muchas gracias!
```

Cada pedido queda registrado en **Panel → Pedidos**, donde podés cambiar su estado (nuevo, confirmado, entregado o cancelado).

## Variables de entorno

Copiá `.env.example` a `.env` y ajustá lo que necesites.

| Variable | Para qué sirve | Por defecto |
|---|---|---|
| `PORT` | Puerto del servidor | `3000` |
| `NODE_ENV` | En `production` la cookie de sesión exige HTTPS | — |
| `DATA_DIR` | Carpeta de la base y las fotos | `./data` |
| `TIMEZONE` | Zona horaria para horarios y menús | `America/Argentina/Buenos_Aires` |
| `TRUST_PROXY` | `1` si corre detrás de Nginx, Render, Railway, etc. | — |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Crean el primer administrador al iniciar, si no hay ninguno (útil en hostings sin consola). Borralas después. | — |

## Publicarlo en internet

Necesitás un servicio que ejecute Node.js y tenga **disco persistente**, porque la base y las fotos viven en `DATA_DIR`.

- **VPS** (DonWeb Cloud, DigitalOcean, Hetzner, etc.): `npm install --omit=dev`, `NODE_ENV=production TRUST_PROXY=1 npm start` con `pm2` o `systemd`, detrás de Nginx con HTTPS (Let's Encrypt).
- **Railway o Render:** creá el servicio desde el repositorio, montá un volumen o disco persistente y apuntá `DATA_DIR` a esa ruta. Definí `NODE_ENV=production`, `TRUST_PROXY=1`, `ADMIN_USER` y `ADMIN_PASSWORD`.
- **Docker:** hay un `Dockerfile` incluido. Ejemplo: `docker run -p 3000:3000 -v viandas-data:/app/data -e ADMIN_USER=dueno -e ADMIN_PASSWORD='una-clave-larga' viandas`.

Usá siempre **HTTPS** en producción.

**Copias de seguridad:** alcanza con copiar la carpeta `data/` (la base y las fotos). Con la app en marcha, lo más seguro es `sqlite3 data/viandas.db ".backup backup.db"` y además copiar `data/uploads/`.

## Estructura del proyecto

```
src/
  server.js          Express: rutas, archivos estáticos y manejo de errores
  config.js          Variables de entorno
  db.js              Esquema SQLite, migraciones y configuración por defecto
  auth.js            Login, sesiones, CSRF y límite de intentos
  routes/public.js   API pública: /api/store, /api/orders
  routes/admin.js    API del panel: viandas, categorías, menús, zonas, configuración, pedidos y usuarios
  lib/order.js       Validación del pedido, cálculo de importes y mensaje de WhatsApp
  lib/menu.js        Elige el menú vigente
  lib/images.js      Subida y optimización de fotos
views/               Páginas del panel (solo se entregan con sesión)
public/              Tienda (index.html, css, js) y archivos del panel
scripts/             create-admin y seed-demo
test/                Pruebas de integración de la API
```

### Base de datos

Tablas: `categories`, `products`, `weekly_menus`, `menu_items` (vianda × menú × día; día 0 = todos los días), `delivery_zones`, `settings` (configuración en clave/valor JSON), `admins`, `sessions` y `orders`. Para ampliar el proyecto, agregá una migración nueva al final del array `migrations` en `src/db.js`; se aplica sola al iniciar.
