-- paid_total guarda el valor de la multa saldada; el exceso pagado solo va al saldo (credit_log).
create or replace function public.pay_fine(p_fine uuid, p_cash numeric)
returns public.fines language plpgsql security definer set search_path = '' as $$
declare me public.members := public.my_member(); f public.fines; m public.members;
        due numeric; use_c numeric; cash numeric := greatest(0, coalesce(p_cash,0)); extra numeric;
begin
  if me.id is null then raise exception 'NOT_ALLOWED'; end if;
  select * into f from public.fines where id = p_fine and team_id = me.team_id for update;
  if not found then raise exception 'FINE_NOT_FOUND'; end if;
  if f.paid then raise exception 'ALREADY_PAID'; end if;
  select * into m from public.members where id = f.member_id for update;

  due   := public.fine_due(f);
  use_c := least(m.credit, due);
  extra := greatest(0, cash + use_c - due);

  update public.members set credit = credit - use_c + extra where id = m.id;
  if use_c > 0 then
    insert into public.credit_log(team_id, member_id, delta, reason, created_by)
    values (f.team_id, m.id, -use_c, 'Saldo aplicado a «' || coalesce(f.reason,'multa') || '»', me.id);
  end if;
  if extra > 0 then
    insert into public.credit_log(team_id, member_id, delta, reason, created_by)
    values (f.team_id, m.id, extra, 'Pagó de más en «' || coalesce(f.reason,'multa') || '»', me.id);
  end if;

  update public.fines set paid = true, paid_at = now(), paid_mult = public.fine_mult(f),
         paid_total = f.credit_used + due, paid_by = me.id
  where id = f.id returning * into f;
  return f;
end $$;
