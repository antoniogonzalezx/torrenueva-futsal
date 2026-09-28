#!/usr/bin/env python3
"""Convierte el PDF de calendario de la FFCM en el SQL de una competición.

Uso:
  pip install pypdf
  python3 scripts/calendario_pdf.py Calendario.pdf --team senior \
      --temporada 22 --competicion 22916226 --grupo 23193707 > calendario.sql

Los códigos salen de la URL del calendario en ffcm.es (codtemporada, codcompeticion, codgrupo).
El SQL resultante se ejecuta en el editor SQL de Supabase; se puede repetir sin duplicar nada.
"""
import argparse, re, sys, unicodedata
from datetime import date
from pypdf import PdfReader


def norm(s):
    s = unicodedata.normalize("NFD", s.upper())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip()


def q(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--team", required=True, help="slug del equipo en la app (senior, juvenil…)")
    ap.add_argument("--temporada", type=int, required=True)
    ap.add_argument("--competicion", type=int, required=True)
    ap.add_argument("--grupo", type=int, required=True)
    ap.add_argument("--club", default="TORRENUEVA", help="texto que identifica a nuestro equipo")
    a = ap.parse_args()

    text = "\n".join(p.extract_text() for p in PdfReader(a.pdf).pages)

    title = re.search(r"^\s*(CAMPEONATO.*?)\s+Temporada", text, re.M)
    comp_name = re.sub(r"\s+", " ", title.group(1)).strip() if title else "Liga"

    # Equipos: «  8.- NOMBRE DEL EQUIPO (2660)»
    teams = [re.sub(r"\s+", " ", m.group(1)).strip()
             for m in re.finditer(r"^\s*\d+\.-\s+(.+?)\s+\(\d+\)\s*$", text, re.M)]
    if not teams:
        sys.exit("No se encontró la lista de equipos")
    ours = [t for t in teams if norm(a.club) in norm(t)]
    if len(ours) != 1:
        sys.exit(f"--club debe identificar un solo equipo; coincide con {ours}")
    by_norm = {norm(t): t for t in teams}

    # Los nombres se parten en varias líneas: se buscan sobre el texto normalizado de cada jornada.
    alts = sorted([re.escape(k) for k in by_norm] + ["DESCANSA"], key=len, reverse=True)
    token = re.compile("|".join(alts))
    heads = list(re.finditer(r"Jornada (\d+) \((\d\d)-(\d\d)-(\d{4})\)", text))
    rounds = []
    for i, h in enumerate(heads):
        chunk = text[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        chunk = chunk.split("Datos de interés")[0]
        toks = token.findall(norm(chunk))
        if len(toks) % 2:
            sys.exit(f"Jornada {h.group(1)}: número impar de equipos ({toks})")
        pairs = [(toks[j], toks[j + 1]) for j in range(0, len(toks), 2)]
        matches = [(by_norm[x], by_norm[y]) for x, y in pairs if "DESCANSA" not in (x, y)]
        seen = [t for m in matches for t in m]
        if len(seen) != len(set(seen)) or len(seen) != len(teams) - len(teams) % 2:
            sys.exit(f"Jornada {h.group(1)}: equipos repetidos o que faltan")
        d = date(int(h.group(4)), int(h.group(3)), int(h.group(2)))
        rounds.append((int(h.group(1)), d, matches))

    # Liga a doble vuelta: cada cruce, una vez en cada campo.
    all_matches = [m for _, _, ms in rounds for m in ms]
    if len(all_matches) != len(set(all_matches)):
        sys.exit("Hay partidos repetidos")

    out = sys.stdout.write
    out(f"-- {comp_name} · generado con scripts/calendario_pdf.py\n")
    out(f"-- {len(teams)} equipos, {len(rounds)} jornadas, {len(all_matches)} partidos.\n\n")
    out("begin;\n\n")
    out("insert into public.competitions (team_id, name, club_name, ffcm_temporada, ffcm_competicion, ffcm_grupo)\n")
    out(f"select id, {q(comp_name)}, {q(ours[0])}, {a.temporada}, {a.competicion}, {a.grupo}\n")
    out(f"from public.teams where slug = {q(a.team)}\n")
    out("on conflict (team_id) do update set name = excluded.name, club_name = excluded.club_name,\n")
    out("  ffcm_temporada = excluded.ffcm_temporada, ffcm_competicion = excluded.ffcm_competicion, ffcm_grupo = excluded.ffcm_grupo;\n\n")

    out("insert into public.rounds (competition_id, num, match_date)\n")
    out(f"select c.id, v.num, v.d::date from public.competitions c join public.teams t on t.id = c.team_id, (values\n")
    out(",\n".join(f"  ({n}, '{d.isoformat()}')" for n, d, _ in rounds))
    out(f"\n) as v(num, d) where t.slug = {q(a.team)}\n")
    out("on conflict (competition_id, num) do update set match_date = excluded.match_date;\n\n")

    out("insert into public.fixtures (round_id, home, away)\n")
    out("select r.id, v.home, v.away from public.rounds r\n")
    out("join public.competitions c on c.id = r.competition_id join public.teams t on t.id = c.team_id, (values\n")
    out(",\n".join(f"  ({n}, {q(h)}, {q(w)})" for n, _, ms in rounds for h, w in ms))
    out(f"\n) as v(num, home, away) where t.slug = {q(a.team)} and r.num = v.num\n")
    out("on conflict (round_id, home, away) do nothing;\n\n")
    out("commit;\n")


if __name__ == "__main__":
    main()
