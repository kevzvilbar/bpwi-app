-- Store editable org chart header metadata (title, subtitle, shift legends) per organization

alter table organizations
  add column if not exists org_chart_meta jsonb;
