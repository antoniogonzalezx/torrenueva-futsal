# Torrenueva FS · app de multas 2026/27

Una PWA por equipo, con el mismo código para las dos:

| Equipo  | Enlace para el grupo | Carpeta    |
|---------|----------------------|------------|
| Senior  | `https://<tu-dominio>/senior/`  | `senior/`  |
| Juvenil | `https://<tu-dominio>/juvenil/` | `juvenil/` |

Cada carpeta tiene su propio `manifest.webmanifest`, sus iconos y su `sw.js`, así que cada enlace
se instala como una app independiente, y la sesión de cada una se guarda por separado. La raíz (`/`) es una portada con
los dos enlaces y desinstala el service worker de la app 25/26.

```
app/            código compartido (app.js, app.css, fuentes, supabase-js)
senior/         PWA del senior    (window.TEAM = { slug: 'senior', … })
juvenil/        PWA del juvenil   (window.TEAM = { slug: 'juvenil', … })
supabase/       migraciones y seed de la temporada 26/27
```

## Acceso

* **Crear cuenta**: el jugador busca su nombre en la plantilla, mete el **código del equipo** y elige contraseña.
  Cada nombre solo se puede reclamar una vez. El servidor lo valida en un trigger de `auth.users`, así que no depende del navegador.
* **Entrar**: toca su nombre y pone la contraseña. No hace falta email: por dentro se usa `<id>@jugadores.torrenuevafs.app`.
* **Olvidó la contraseña**: un admin abre su ficha y pulsa *Liberar cuenta*; el jugador vuelve a registrarse.
* Los códigos de equipo se guardan con hash (bcrypt). Para cambiarlos:
  ```sql
  update public.teams set join_code_hash = extensions.crypt('NUEVO-CODIGO', extensions.gen_salt('bf')) where slug = 'senior';
  ```
* Para nombrar al primer admin:
  ```sql
  update public.members set is_admin = true where name = 'Antonio' and team_id = (select id from teams where slug = 'senior');
  ```

### Ajustes necesarios en Supabase (Dashboard → Authentication)

1. **Sign In / Providers → Email**: activado, con **Confirm email desactivado** (los emails son internos y nunca llegan).
2. **Allow new users to sign up**: activado. Sin el código del equipo nadie puede registrarse igualmente.

## Datos

La temporada 26/27 usa tablas nuevas (`teams`, `members`, `fines`, `credit_log`, `messages`) con RLS: cada jugador
solo ve y escribe los datos de su equipo. Las tablas de la 25/26 (`players`, `multas`, …) no se han tocado.

* Las multas se duplican a los 15 días (×2) y a los 29 (×4); los cobros no se duplican.
* Si alguien paga de más, el exceso queda como **saldo a favor** y se descuenta de su siguiente multa automáticamente.
  Toda esta lógica corre en funciones SQL (`add_fine`, `pay_fine`, `delete_fine`) para que el saldo no se descuadre.
* Las fichas (datos y estadísticas) las puede editar cualquier jugador registrado. El saldo, el admin y la cuenta, no.
* Las fotos (perfil y chat) se comprimen en el móvil y se suben al bucket `media`, en la carpeta del equipo.

## Chat

El chat es tiempo real (Supabase Realtime) y admite texto, fotos y GIFs. Para **buscar** GIFs dentro de la app, crea una
clave gratuita en developers.giphy.com y ponla en `GIPHY_KEY` (`app/app.js`). Sin clave, se pueden enviar GIFs guardados en el móvil.
