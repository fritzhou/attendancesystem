-- ============================================================
--  /sql/storage.sql — Phase 7: student photo storage bucket
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-photos', 'student-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Anyone (including anonymous visitors) may upload ONLY into the
-- pending/ folder — that's the one place registration photos land
-- before a staff member reviews them. No read, overwrite, or delete.
create policy "anon_upload_pending_photos"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'student-photos'
    and (storage.foldername(name))[1] = 'pending'
  );

-- Only logged-in staff (admin/teacher) can view any photo in this bucket
create policy "staff_read_student_photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'student-photos' and public.is_staff());

create policy "staff_update_student_photos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'student-photos' and public.is_staff());

create policy "staff_delete_student_photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'student-photos' and public.is_staff());
