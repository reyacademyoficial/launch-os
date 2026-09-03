-- Academia: toda venta de un producto asociado a un curso crea al estudiante.
-- La cohorte sigue siendo una decisión manual: este trigger sólo da de alta la
-- persona en `students`. Es idempotente por proyecto + email/teléfono.

create or replace function public.academia_ensure_student_for_sale(p_sale_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_name text;
  v_email text;
  v_phone text;
  v_closed_at timestamptz;
  v_student_id uuid;
begin
  select s.project_id,
         coalesce(nullif(trim(l.name), ''), nullif(lower(trim(l.email)), ''),
                  nullif(trim(l.phone_normalized), ''), 'Estudiante sin nombre'),
         nullif(lower(trim(l.email)), ''),
         nullif(trim(l.phone_normalized), ''),
         s.closed_at
    into v_project_id, v_name, v_email, v_phone, v_closed_at
    from public.sales s
    join public.leads l on l.id = s.lead_id
   where s.id = p_sale_id
     and exists (
       select 1
         from public.courses c
        where c.product_id = s.product_id
          and c.active
     );

  if not found then
    return null;
  end if;

  -- Sin una identidad estable no podemos evitar duplicados entre compras.
  if v_email is null and v_phone is null then
    return null;
  end if;

  select st.id
    into v_student_id
    from public.students st
   where st.project_id = v_project_id
     and (
       (v_email is not null and lower(trim(st.email)) = v_email)
       or (v_phone is not null and st.phone_normalized = v_phone)
     )
   order by
     case when v_email is not null and lower(trim(st.email)) = v_email then 0 else 1 end,
     st.created_at
   limit 1;

  if v_student_id is not null then
    return v_student_id;
  end if;

  begin
    insert into public.students (
      project_id, name, email, phone, phone_normalized, status, enrolled_at
    ) values (
      v_project_id, v_name, v_email, v_phone, v_phone, 'active',
      coalesce(v_closed_at::date, current_date)
    )
    returning id into v_student_id;
  exception
    when unique_violation then
      -- Dos ventas simultáneas de la misma persona pueden competir. El índice
      -- de students decide y recuperamos la fila ganadora.
      select st.id
        into v_student_id
        from public.students st
       where st.project_id = v_project_id
         and (
           (v_email is not null and lower(trim(st.email)) = v_email)
           or (v_phone is not null and st.phone_normalized = v_phone)
         )
       order by st.created_at
       limit 1;
  end;

  return v_student_id;
end;
$$;

create or replace function public.academia_student_from_sale_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.academia_ensure_student_for_sale(new.id);
  return new;
end;
$$;

drop trigger if exists academia_create_student on public.sales;
create trigger academia_create_student
  after insert or update of product_id, lead_id on public.sales
  for each row execute function public.academia_student_from_sale_trigger();

-- Si el curso se matchea después de que ocurrieron las ventas, esas ventas
-- también deben transformarse en estudiantes.
create or replace function public.academia_students_from_course_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale record;
begin
  if new.active then
    for v_sale in
      select s.id from public.sales s where s.product_id = new.product_id
    loop
      perform public.academia_ensure_student_for_sale(v_sale.id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists academia_create_students on public.courses;
create trigger academia_create_students
  after insert or update of product_id, active on public.courses
  for each row execute function public.academia_students_from_course_trigger();

-- Completa el normalizado omitido por las altas manuales anteriores. Puede
-- haber varias filas históricas con el mismo `phone` y normalizado NULL: sólo
-- elegimos una fila canónica por proyecto/teléfono para respetar el índice
-- unique sin eliminar ni fusionar información existente.
with phone_candidates as (
  select st.id,
         st.project_id,
         regexp_replace(st.phone, '[^0-9+]', '', 'g') as normalized_phone,
         row_number() over (
           partition by st.project_id,
                        regexp_replace(st.phone, '[^0-9+]', '', 'g')
           order by st.created_at, st.id
         ) as duplicate_rank
    from public.students st
   where st.phone_normalized is null
     and st.phone is not null
     and regexp_replace(st.phone, '[^0-9+]', '', 'g') <> ''
), safe_phone_candidates as (
  select candidate.id, candidate.normalized_phone
    from phone_candidates candidate
   where candidate.duplicate_rank = 1
     and not exists (
       select 1
         from public.students existing
        where existing.project_id = candidate.project_id
          and existing.phone_normalized = candidate.normalized_phone
     )
)
update public.students st
   set phone_normalized = candidate.normalized_phone
  from safe_phone_candidates candidate
 where st.id = candidate.id;

-- Backfill de todas las ventas históricas cuyo producto ya es curso activo.
do $$
declare
  v_sale record;
begin
  for v_sale in
    select s.id
      from public.sales s
     where exists (
       select 1 from public.courses c
        where c.product_id = s.product_id and c.active
     )
  loop
    perform public.academia_ensure_student_for_sale(v_sale.id);
  end loop;
end;
$$;

revoke all on function public.academia_ensure_student_for_sale(uuid) from public;
revoke all on function public.academia_student_from_sale_trigger() from public;
revoke all on function public.academia_students_from_course_trigger() from public;
