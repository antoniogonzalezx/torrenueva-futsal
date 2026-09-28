# Torrenueva FS

App web progresiva (PWA) para gestionar las multas, los partidos y la plantilla de un equipo de fútbol sala.
Sin build: HTML, CSS y JavaScript estáticos servidos por GitHub Pages, con [Supabase](https://supabase.com) como backend
(Postgres, Auth, Storage, Realtime y Edge Functions).

## Estructura

```
index.html              portada con un enlace por equipo
sw.js                   desinstala el service worker de la versión anterior (servida desde la raíz)
app/                    código compartido
  app.js                toda la lógica de la interfaz (vanilla JS)
  app.css               estilos
  icons.js              iconos SVG de css.gg
  sw-core.js            service worker compartido (caché + notificaciones push)
  fonts/                Inter (variable, woff2)
  vendor/               supabase-js (UMD)
<equipo>/               una PWA por equipo (p. ej. senior/, juvenil/)
  index.html            define window.TEAM = { slug, name, label, season }
  manifest.webmanifest  nombre, colores e iconos propios → cada equipo se instala como app independiente
  sw.js                 nombre de caché y lista de precarga; importa app/sw-core.js
  icon-*.png
supabase/
  migrations/           esquema, RLS, funciones y triggers
  functions/signup/     alta de jugadores (valida el código y crea la cuenta)
  functions/notify/     edge function de notificaciones push
  functions/ffcm-sync/  lee resultados y horarios de ffcm.es
  seeds/                calendario de la liga de cada equipo (generado con scripts/calendario_pdf.py)
  seed.example.sql      cómo dar de alta un equipo y su plantilla
scripts/
  calendario_pdf.py     convierte el PDF de calendario de la federación en SQL
```

Todas las rutas son relativas, así que funciona tanto en la raíz de un dominio como en un subdirectorio.

## Funcionalidades

- **Multas**: pendientes por jugador; se duplican a los 15 días y se cuadruplican a los 29 (los «cobros» no).
  Si alguien paga de más, el exceso queda como saldo a favor y se descuenta de la siguiente multa.
- **Feed**: partidos publicados por los jugadores (rival, resultado, goles, asistencias, paradas, foto) y cada multa
  nueva. Todo admite «kudos» y comentarios. Publicar un partido suma a las estadísticas del jugador.
- **Plantilla y ficha**: foto, dorsal, posición y estadísticas de fútbol sala; los porteros tienen además paradas,
  goles encajados y porterías a cero.
- **Historial**: recaudación, ranking y movimientos de saldo.
- **Quiniela** (solo equipos con competición): pestaña con dos apartados.
  - *Jornada*: la jornada abierta, con todos los partidos del grupo menos el nuestro. Signo único acertado: 3 puntos;
    doble acertado: 1 punto; máximo 4 dobles. Se entrega entera y se puede cambiar hasta el viernes a las 14:00
    (hora de Madrid); después se ven los pronósticos de todos.
  - *Ranking*: total o por jornada (desplegable con las jornadas cerradas).
  - Solo hay una jornada abierta. El domingo a las 22:00 se leen los resultados, se cierra (lo que siga sin
    resultado, como un aplazado, se anula) y se abre la siguiente. Cuenta el resultado oficial de la federación.
  - Empate en el ranking: más plenos y, después, menos dobles usados.
  - Los admins pueden corregir un resultado o anular un partido tocándolo (la sincronización deja de tocarlo).

## Backend

### Acceso

Cada jugador reclama su nombre de la plantilla con el código del equipo y una contraseña. El alta la hace la edge
function `signup`: valida el código (guardado con bcrypt) y crea la cuenta ya confirmada con la API de administración
de Supabase Auth. Así no se envían correos: el email de cada cuenta es interno (`<id>@<dominio>`) y no existe. Un
trigger en `auth.users` repite la validación y vincula la cuenta al jugador. El inicio de sesión es el normal de
Supabase (email interno + contraseña).

### Datos y permisos

| Tabla | Contenido |
| --- | --- |
| `teams` | equipos y hash del código de acceso |
| `members` | jugadores, estadísticas, saldo, rol de admin |
| `fines`, `credit_log` | multas y movimientos de saldo |
| `posts`, `post_likes`, `post_comments` | feed |
| `push_subscriptions` | suscripciones Web Push |
| `competitions`, `rounds`, `fixtures` | liga: competición, jornadas (con su cierre) y partidos |
| `picks` | pronósticos de la quiniela (vista `pick_points` con los puntos) |
| `app_secrets` | claves VAPID y secreto del webhook (solo `service_role`) |

- RLS en todas las tablas: cada usuario solo ve y modifica los datos de su equipo.
- Las operaciones con dinero (`add_fine`, `pay_fine`, `delete_fine`) y las de admin se hacen en funciones
  `security definer` que comprueban la pertenencia al equipo.
- Las columnas sensibles (`credit`, `is_admin`, `user_id`) no son editables desde el cliente.

### Fotos

Se comprimen en el navegador antes de subirlas: WebP, o JPEG si el navegador no codifica WebP. Perfil a 480 px,
publicaciones a 1280 px. El bucket `media` acepta solo WebP/JPEG de hasta 1,5 MB, y las fotos sustituidas se borran.

### Notificaciones push

- Triggers en `posts`, `post_comments` y `post_likes` llaman con `pg_net` a la edge function `notify`.
- `pg_cron` la llama cada día con `{ "type": "reminders" }` para avisar de las multas que se duplican en 2 días.
- Quiniela: `pg_cron` avisa el jueves por la tarde y el viernes por la mañana a quien no la ha entregado
  (`{ "type": "quiniela_reminder" }`), y `ffcm-sync` pide el push con los puntos de la jornada (`quiniela_results`)
  al cerrar la jornada, el domingo a las 22:00.

### Quiniela y resultados

- `scripts/calendario_pdf.py` convierte el PDF de calendario de ffcm.es en SQL (competición, jornadas y partidos).
  Los códigos `codtemporada`, `codcompeticion` y `codgrupo` salen de la URL del calendario en la web.
- ffcm.es devuelve páginas vacías a los servidores de Supabase, así que las descarga GitHub: el workflow
  `.github/workflows/ffcm-sync.yml` se ejecuta los domingos a las 22:00 de Madrid (programado a las 20:00 y 21:00 UTC;
  el script solo sigue en la que toca según el horario de verano o invierno). `scripts/ffcm_fetch.mjs` pide a
  `ffcm-sync` qué páginas necesita, las descarga (abriendo sesión en la web, que exige cookie) y se las manda.
  Necesita el secreto de repositorio `FFCM_SYNC_SECRET` (valor de `webhook_secret` en `app_secrets`). También se
  puede lanzar a mano: Actions → Resultados ffcm.es → Run workflow.
- `ffcm-sync` busca cada partido por el nombre de los equipos en el calendario (toda la temporada en una página),
  guarda los resultados, cierra la jornada (`close_rounds()`) y pide a `notify` el push con los puntos.
  Con `?debug=<jornada>` devuelve el texto que extrae de la web.
- Respaldo: si el domingo falla, `pg_cron` cierra la jornada el lunes a las 06:00 UTC y manda el push.

## Puesta en marcha

1. Crea un proyecto de Supabase y aplica `supabase/migrations/` en orden.
2. Da de alta los equipos y la plantilla siguiendo `supabase/seed.example.sql`.
3. Genera claves VAPID (`npx web-push generate-vapid-keys`) y guárdalas en `app_secrets`, junto a un secreto para el
   webhook. Despliega `supabase/functions/notify` y `supabase/functions/signup` sin verificación JWT
   (`notify` se autentica con ese secreto; `signup` es pública y valida el código del equipo).
   Despliega también `supabase/functions/ffcm-sync` sin verificación JWT (acepta el secreto o el JWT de un admin).
   Para la liga, ejecuta el SQL del calendario del equipo (`supabase/seeds/`).
4. En `app/app.js`, pon la URL del proyecto, la clave `anon` y la clave VAPID pública.
5. Para cada equipo, copia una carpeta de equipo y ajusta `window.TEAM`, el manifest, la caché del `sw.js` y los iconos.
6. Publica el repositorio con GitHub Pages: rama `main`, carpeta raíz.

La clave `anon` de Supabase es pública por diseño: la seguridad depende de las políticas RLS, no de ocultarla.

## Créditos

Iconos: [css.gg](https://github.com/astrit/css.gg) (MIT). Tipografía: [Inter](https://rsms.me/inter/) (OFL).
