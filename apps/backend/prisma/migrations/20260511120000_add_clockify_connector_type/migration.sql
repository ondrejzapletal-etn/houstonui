-- Migration: add CLOCKIFY to ConnectorType enum
-- PostgreSQL does not support removing enum values, only adding them.

ALTER TYPE "ConnectorType" ADD VALUE 'CLOCKIFY';
