-- The mobile dock has three user-selectable routes in addition to Dashboard,
-- the centered Add action, and the Settings header action.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_navbar_layout_shape_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_navbar_layout_shape_check CHECK (
    jsonb_typeof(navbar_layout) = 'object'
    AND CASE
      WHEN jsonb_typeof(navbar_layout->'mobileSelectedUrls') = 'array'
        THEN jsonb_array_length(navbar_layout->'mobileSelectedUrls') <= 3
      ELSE false
    END
    AND CASE
      WHEN jsonb_typeof(navbar_layout->'desktopSelectedUrls') = 'array'
        THEN jsonb_array_length(navbar_layout->'desktopSelectedUrls') <= 10
      ELSE false
    END
  );
