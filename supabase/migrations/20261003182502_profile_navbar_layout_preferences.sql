-- Navbar layout is a non-sensitive personal preference and follows the owner
-- across devices. Row ownership remains enforced by profiles_read_own.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS navbar_layout jsonb NOT NULL
  DEFAULT '{"mobileSelectedUrls":["/ledger","/chittis"],"desktopSelectedUrls":["/ledger","/calendar","/chittis"]}'::jsonb;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_navbar_layout_shape_check CHECK (
    jsonb_typeof(navbar_layout) = 'object'
    AND CASE
      WHEN jsonb_typeof(navbar_layout->'mobileSelectedUrls') = 'array'
        THEN jsonb_array_length(navbar_layout->'mobileSelectedUrls') <= 2
      ELSE false
    END
    AND CASE
      WHEN jsonb_typeof(navbar_layout->'desktopSelectedUrls') = 'array'
        THEN jsonb_array_length(navbar_layout->'desktopSelectedUrls') <= 10
      ELSE false
    END
  );

GRANT UPDATE (navbar_layout) ON TABLE public.profiles TO authenticated;
NOTIFY pgrst, 'reload schema';
