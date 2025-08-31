-- Create table to store per-student overrides for subject totals
CREATE TABLE IF NOT EXISTS public.student_subject_totals (
  student_id uuid NOT NULL,
  subject text NOT NULL,
  group_name text NOT NULL,
  total integer NOT NULL DEFAULT 0,
  PRIMARY KEY (student_id, subject)
);

-- Enable Row Level Security
ALTER TABLE public.student_subject_totals ENABLE ROW LEVEL SECURITY;

-- Allow the authenticated user to SELECT their own overrides
CREATE POLICY "Allow users to select their own totals" ON public.student_subject_totals
  FOR SELECT USING (auth.uid() = student_id);

-- Allow the authenticated user to insert/update/delete their own overrides
CREATE POLICY "Allow users to manage their own totals" ON public.student_subject_totals
  FOR ALL USING (auth.uid() = student_id) WITH CHECK (auth.uid() = student_id);

-- Optional index for quick lookups by student
CREATE INDEX IF NOT EXISTS idx_student_subject_totals_student ON public.student_subject_totals(student_id);
