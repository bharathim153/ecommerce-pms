SET @cust = (SELECT id FROM users WHERE email='customer@example.com');
SET @adm = (SELECT id FROM users WHERE email='admin@example.com');
INSERT INTO products (name,slug,sku,price,stock,status,short_description,created_at,updated_at) VALUES
 ('Dash Widget','dash-widget','DASH-1',60.00,10,'published','A widget',NOW(),NOW()),
 ('Dash Gadget','dash-gadget','DASH-2',45.00,10,'published','A gadget',NOW(),NOW()),
 ('Dash Draft','dash-draft','DASH-3',10.00,10,'draft',NULL,NOW(),NOW());
-- paid orders: (days ago, total, provider)
INSERT INTO product_orders (number,user_id,status,subtotal,total,currency,paid_at,created_at,updated_at) VALUES
 ('DASH-A',@cust,'paid',120.00,120.00,'USD',NOW(),NOW(),NOW()),
 ('DASH-B',@cust,'paid',80.50,80.50,'USD',NOW()-INTERVAL 1 DAY,NOW()-INTERVAL 1 DAY,NOW()),
 ('DASH-C',@cust,'paid',45.00,45.00,'USD',NOW()-INTERVAL 2 DAY,NOW()-INTERVAL 2 DAY,NOW()),
 ('DASH-D',@cust,'paid',300.00,300.00,'USD',NOW()-INTERVAL 5 DAY,NOW()-INTERVAL 5 DAY,NOW()),
 ('DASH-E',@cust,'paid',60.00,60.00,'USD',NOW()-INTERVAL 10 DAY,NOW()-INTERVAL 10 DAY,NOW()),
 ('DASH-F',@cust,'paid',210.00,210.00,'USD',NOW()-INTERVAL 25 DAY,NOW()-INTERVAL 25 DAY,NOW()),
 ('DASH-G',@cust,'paid',90.00,90.00,'USD',NOW()-INTERVAL 40 DAY,NOW()-INTERVAL 40 DAY,NOW()),
 ('DASH-P',@cust,'pending',50.00,50.00,'USD',NULL,NOW(),NOW()),
 ('DASH-X',@cust,'failed',20.00,20.00,'USD',NULL,NOW()-INTERVAL 3 DAY,NOW());
INSERT INTO order_items (order_id,product_id,product_name,sku,unit_price,quantity,line_total,created_at,updated_at)
 SELECT o.id,(SELECT id FROM products WHERE sku='DASH-1'),'Dash Widget','DASH-1',o.total,1,o.total,NOW(),NOW() FROM product_orders o WHERE o.number LIKE 'DASH-%';
INSERT INTO payments (order_id,provider,provider_reference,provider_transaction_id,amount,currency,status,created_at,updated_at)
 SELECT id,IF(number IN ('DASH-A','DASH-C','DASH-E','DASH-G'),'stripe','paypal'),CONCAT('ref-',number),CONCAT('tx-',number),total,'USD','succeeded',paid_at,paid_at FROM product_orders WHERE status='paid' AND number LIKE 'DASH-%';
INSERT INTO payments (order_id,provider,provider_reference,amount,currency,status,created_at,updated_at)
 SELECT id,'stripe','ref-fail',20.00,'USD','failed',NOW()-INTERVAL 3 DAY,NOW() FROM product_orders WHERE number='DASH-X';
INSERT INTO pdf_exports (user_id,scope,status,total_products,processed_products,progress,page_count,created_at,updated_at) VALUES (@adm,'all','completed',3,3,100,16,NOW(),NOW());
INSERT INTO email_subscribers (email,name,is_subscribed,unsubscribe_token,subscribed_at,source,created_at,updated_at) VALUES ('d1@e2e.test','D1',1,'tokd1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',NOW(),'manual',NOW(),NOW());
INSERT INTO email_campaigns (created_by,subject,body_html,status,total_recipients,sent_count,delivered_count,failed_count,created_at,updated_at) VALUES (@adm,'Dash campaign','<p>x</p>','completed',10,9,8,1,NOW(),NOW());
