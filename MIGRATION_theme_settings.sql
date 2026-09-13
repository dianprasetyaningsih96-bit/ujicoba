-- =====================================================================
-- Migration: Add theme_color to app_settings
-- =====================================================================

-- Menambahkan kolom theme_color pada app_settings (opsional / default 'ocean')
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS theme_color text DEFAULT 'ocean';