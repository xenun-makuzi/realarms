-- Delivery methods: store pickup and shipping are published; licensed dealer transfer is hidden.
-- Run once in Supabase > SQL Editor. Safe to run again: it never creates duplicates.
-- This only changes data. The files in supabase/migrations are not touched.
do $$
declare
  ship_fee numeric := 25;   -- <-- set your shipping fee here (0 = free)
begin
  -- Create the two methods if that type does not exist yet.
  if not exists (select 1 from public.shipping_methods where method_type = 'pickup') then
    insert into public.shipping_methods (name, description, method_type, price, display_order, status)
    values ('Store pickup', 'Collect in person after eligibility checks.', 'pickup', 0, 1, 'published');
  end if;
  if not exists (select 1 from public.shipping_methods where method_type = 'ship') then
    insert into public.shipping_methods (name, description, method_type, price, display_order, status)
    values ('Standard shipping', 'Shipped to your address once your order is approved and paid.', 'ship', ship_fee, 2, 'published');
  end if;

  -- Publish the oldest row of each type (any duplicates are hidden) and hide dealer transfer.
  update public.shipping_methods m
     set status = case when m.id = (select s.id from public.shipping_methods s
                                     where s.method_type = m.method_type
                                     order by s.created_at, s.id limit 1)
                       then 'published' else 'draft' end
   where m.method_type in ('pickup', 'ship');
  update public.shipping_methods set status = 'draft' where method_type = 'licensed_transfer';

  -- Order and fees.
  update public.shipping_methods set display_order = 1, price = 0 where method_type = 'pickup';
  update public.shipping_methods set display_order = 2, price = ship_fee where method_type = 'ship';

  -- Let products on the default setting ship. Items you set to pickup_only are left alone.
  update public.products set fulfilment = 'ship' where fulfilment = 'licensed_transfer';
end $$;
