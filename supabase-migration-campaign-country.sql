-- Tenant-shaped analytics: campaigns carry an explicit ISO-2 country instead of the dashboard
-- guessing it from the campaign NAME (a Lucky7even naming convention). Brand is the explicit
-- cio_workspace slug; the legacy NULL-means-lucky7even rule is made explicit here.
-- Run in the Supabase SQL editor after supabase-migration-saas-tenancy.sql. Safe to re-run.

alter table campaigns_v2 add column if not exists country text;
create index if not exists campaigns_v2_country_idx on campaigns_v2 (country);

-- E.164 → ISO-2 for the countries we expect to dial. +1 splits Canada by area code, else US.
create or replace function voizo_country_from_e164(p text) returns text language plpgsql immutable as $$
declare
  d text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
  a3 text;
begin
  if d = '' then return null; end if;
  case substr(d, 1, 3)
    when '353' then return 'IE'; when '351' then return 'PT'; when '358' then return 'FI'; when '380' then return 'UA';
    when '420' then return 'CZ'; when '852' then return 'HK'; when '971' then return 'AE'; when '966' then return 'SA';
    when '972' then return 'IL'; when '234' then return 'NG'; when '254' then return 'KE';
    else null;
  end case;
  case substr(d, 1, 2)
    when '61' then return 'AU'; when '64' then return 'NZ'; when '44' then return 'GB'; when '49' then return 'DE';
    when '33' then return 'FR'; when '34' then return 'ES'; when '39' then return 'IT'; when '31' then return 'NL';
    when '32' then return 'BE'; when '41' then return 'CH'; when '43' then return 'AT'; when '46' then return 'SE';
    when '47' then return 'NO'; when '45' then return 'DK'; when '48' then return 'PL'; when '30' then return 'GR';
    when '90' then return 'TR'; when '27' then return 'ZA'; when '91' then return 'IN'; when '63' then return 'PH';
    when '65' then return 'SG'; when '60' then return 'MY'; when '62' then return 'ID'; when '66' then return 'TH';
    when '84' then return 'VN'; when '81' then return 'JP'; when '82' then return 'KR'; when '86' then return 'CN';
    when '55' then return 'BR'; when '52' then return 'MX'; when '54' then return 'AR'; when '57' then return 'CO';
    when '56' then return 'CL'; when '51' then return 'PE'; when '20' then return 'EG'; when '36' then return 'HU';
    when '40' then return 'RO';
    else null;
  end case;
  if substr(d, 1, 1) = '7' then return 'RU'; end if;
  if substr(d, 1, 1) = '1' then
    a3 := substr(d, 2, 3);
    if a3 in ('204','226','236','249','250','263','289','306','343','354','365','367','368','403','416','418','428','431','437','438','450','468','474','506','514','519','548','579','581','584','587','604','613','639','647','672','683','705','709','742','753','778','780','782','807','819','825','867','873','879','902','905') then
      return 'CA';
    end if;
    return 'US';
  end if;
  return null;
end $$;

-- New campaigns: the first number imported decides the country when none was set explicitly.
create or replace function voizo_set_campaign_country() returns trigger language plpgsql as $$
begin
  update campaigns_v2 set country = voizo_country_from_e164(new.phone_e164)
   where id = new.campaign_id and country is null;
  return new;
end $$;
drop trigger if exists trg_campaign_country on campaign_numbers_v2;
create trigger trg_campaign_country after insert on campaign_numbers_v2
  for each row execute function voizo_set_campaign_country();

-- Backfill 1: the legacy name convention (L7_AU_…, "… - AU | …", "… AU"), limited to real codes.
update campaigns_v2
   set country = substring(name from '(?:^|[_\s])([A-Z]{2})(?=[_\s]|$)')
 where country is null
   and substring(name from '(?:^|[_\s])([A-Z]{2})(?=[_\s]|$)') in
       ('AU','CA','NZ','US','GB','IE','DE','FR','ES','IT','NL','BE','CH','AT','SE','NO','DK','FI','PL','PT','GR','TR','ZA','IN','PH','SG','MY','ID','TH','VN','JP','KR','CN','HK','AE','SA','BR','MX','AR','CO','CL','PE','NG','KE','EG','IL','RU','UA','CZ','HU','RO');

-- Backfill 2: everything else from the numbers that were dialed.
update campaigns_v2 c
   set country = voizo_country_from_e164(n.phone_e164)
  from (select distinct on (campaign_id) campaign_id, phone_e164 from campaign_numbers_v2 order by campaign_id, id) n
 where n.campaign_id = c.id and c.country is null;

-- Brand: NULL used to mean Lucky7even. Make it explicit so the app no longer needs that rule.
update campaigns_v2 set cio_workspace = 'lucky7even' where cio_workspace is null;
