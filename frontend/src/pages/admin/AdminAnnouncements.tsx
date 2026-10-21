import { useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, qs } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatDate } from "@/lib/format";
import { announcementSchema, serverFieldErrors, validate, type FieldErrors } from "@/lib/schemas";
import type { Announcement, Paged } from "@/lib/types";
import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import { Field, fieldProps } from "@/components/Field";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const EXPIRY_OPTIONS = [
  { days: 7, label: "1 week" },
  { days: 30, label: "1 month" },
  { days: 90, label: "3 months" },
];

const empty = { heading: "", content: "", expiresInDays: 30 };

const AdminAnnouncements = () => {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: [...qk.staffAnnouncements, page],
    queryFn: () => api.get<Paged & { announcements: Announcement[] }>(`/admin/get-announcements${qs({ page })}`),
    placeholderData: keepPreviousData,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.staffAnnouncements });
    queryClient.invalidateQueries({ queryKey: qk.staffDashboard });
  };

  const post = useMutation({
    mutationFn: (body: typeof empty) => api.post("/admin/make-announcement", body),
    onSuccess: () => {
      toast.success("Announcement posted", { description: "Every student got a notification." });
      setValues(empty);
      setPage(1);
    },
    onError: (error) => setErrors(serverFieldErrors(error)),
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/delete-announcement/${id}`),
    onSuccess: () => toast.success("Announcement removed"),
    onSettled: refresh,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validate(announcementSchema, values);
    setErrors(result.errors ?? {});
    if (result.data) post.mutate(result.data);
  };

  const data = list.data;

  return (
    <div className="min-h-screen bg-background">
      <Navbar role="admin" />
      <PageHeader title="Announcements" width="max-w-5xl" />

      <main id="main" tabIndex={-1} className="container mx-auto max-w-5xl px-4 md:px-6 pt-10 pb-16 focus:outline-none">
        <div className="grid gap-12 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <section aria-labelledby="post-heading">
            <h2 id="post-heading" className="type-heading text-xl mb-1">
              Post an announcement
            </h2>
            <p className="text-sm text-muted-foreground mb-4">Students see it on their dashboard and get a notification.</p>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <Field id="ann-heading" label="Heading" error={errors.heading}>
                <Input
                  {...fieldProps("ann-heading", errors.heading)}
                  placeholder="Badminton courts closed Saturday"
                  value={values.heading}
                  maxLength={120}
                  onChange={(e) => setValues({ ...values, heading: e.target.value })}
                />
              </Field>
              <Field id="ann-content" label="Message" error={errors.content}>
                <Textarea
                  {...fieldProps("ann-content", errors.content)}
                  placeholder="The floor is being resurfaced. Courts reopen Sunday at 6 AM."
                  value={values.content}
                  maxLength={2000}
                  onChange={(e) => setValues({ ...values, content: e.target.value })}
                  rows={5}
                />
              </Field>
              <fieldset>
                <legend className="text-sm font-medium mb-2">Take it down after</legend>
                <div className="inline-flex rounded-md border border-border p-0.5 bg-card">
                  {EXPIRY_OPTIONS.map((o) => (
                    <button
                      key={o.days}
                      type="button"
                      aria-pressed={values.expiresInDays === o.days}
                      onClick={() => setValues({ ...values, expiresInDays: o.days })}
                      className={cn(
                        "h-8 px-3 rounded-[calc(var(--radius)-2px)] text-sm font-medium transition-colors",
                        values.expiresInDays === o.days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <Button type="submit" className="w-full" disabled={post.isPending}>
                {post.isPending ? "Posting…" : "Post announcement"}
              </Button>
            </form>
          </section>

          <section aria-labelledby="live-heading" className="min-w-0">
            <h2 id="live-heading" className="type-heading text-xl mb-4">
              Live now <span className="text-muted-foreground tabular">{data?.total ?? ""}</span>
            </h2>
            {list.error ? (
              <ErrorState title="Couldn't load announcements" error={list.error} onRetry={() => list.refetch()} />
            ) : !data ? (
              <ListSkeleton rows={2} rowClassName="h-20" />
            ) : data.announcements.length === 0 ? (
              <EmptyState title="Nothing posted">Students see an empty announcements list. Post closures, new equipment or tournaments.</EmptyState>
            ) : (
              <>
                <ul className="space-y-6">
                  {data.announcements.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-4 border-l-[3px] border-primary pl-4">
                      <div className="min-w-0">
                        <p className="font-medium">{a.heading}</p>
                        <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{a.content}</p>
                        <p className="mt-1 text-xs text-muted-foreground tabular">
                          Posted {formatDate(a.createdAt)}
                          {a.createdBy && ` by ${a.createdBy.name ?? a.createdBy.email}`}
                          {a.expireAt && `, comes down ${formatDate(a.expireAt)}`}
                        </p>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="shrink-0 text-muted-foreground hover:text-destructive">
                            Remove
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove this announcement?</AlertDialogTitle>
                            <AlertDialogDescription>“{a.heading}” disappears from every student's dashboard. This can't be undone.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep it</AlertDialogCancel>
                            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => remove.mutate(a.id)}>
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </li>
                  ))}
                </ul>
                {data.totalPages > 1 && (
                  <nav className="mt-6 flex items-center gap-3" aria-label="Pages">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      Newer
                    </Button>
                    <span className="text-sm text-muted-foreground tabular">
                      Page {data.page} of {data.totalPages}
                    </span>
                    <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                      Older
                    </Button>
                  </nav>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

export default AdminAnnouncements;
