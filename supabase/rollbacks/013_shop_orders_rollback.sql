-- Rollback for 013_shop_orders.sql
-- Run this to remove the tables created by 013_shop_orders.sql

DROP TABLE IF EXISTS shop_order_items;
DROP TABLE IF EXISTS shop_orders;
