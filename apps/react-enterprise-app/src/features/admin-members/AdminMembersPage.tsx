import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Card,
  CardBody,
  DataTable,
  Dialog,
  FormField,
  Select,
  type SelectItem,
  Badge,
  LoadingState,
  EmptyState,
  LiveRegion,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import {
  InviteMemberRequestSchema,
  TENANT_ROLES,
  type InviteMemberRequest,
  type MemberSummary,
} from "@platform/contracts-admin";
import { useSession } from "../../hooks/use-session";
import { AdminSectionHeader } from "../../components/AdminLayout";
import { AdminQueryError } from "../admin/AdminQueryError";
import {
  useMembers,
  useInviteMember,
  useUpdateMemberRole,
  useRemoveMember,
} from "./use-admin-members";

/**
 * Members section (ADR-0036). Lists organisation members, invites by email,
 * changes roles, and removes members over `/api/org/members*`. Mutations are
 * re-authorised by the BFF (`tenant.members.*`); the UI hides write controls
 * for readers and the last-admin guard lives server-side.
 */
export function AdminMembersPage() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const canInvite = hasPermission("tenant.members.invite");
  const canUpdate = hasPermission("tenant.members.update_role");
  const canRemove = hasPermission("tenant.members.delete");

  const { data, isLoading, isError, error, refetch } = useMembers();
  const updateRole = useUpdateMemberRole();
  const remove = useRemoveMember();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<MemberSummary | null>(null);

  const roleItems: SelectItem[] = useMemo(
    () => TENANT_ROLES.map((r) => ({ id: r, label: t(`feature.admin.members.role.${r}`) })),
    [t]
  );

  const columns = useMemo<ColumnDef<MemberSummary>[]>(
    () => [
      {
        id: "member",
        header: () => t("feature.admin.members.column.member"),
        cell: ({ row }) => (
          <div>
            <p className="text-sm font-medium text-fg">{row.original.displayName}</p>
            <p className="text-xs text-fg-muted">{row.original.email}</p>
          </div>
        ),
      },
      {
        id: "role",
        header: () => t("feature.admin.members.column.role"),
        cell: ({ row }) =>
          canUpdate ? (
            <Select
              items={roleItems}
              placeholder={t("feature.admin.members.column.role")}
              selectedKey={row.original.role}
              aria-label={t("feature.admin.members.changeRoleFor", {
                name: row.original.displayName,
              })}
              onSelectionChange={(key) =>
                updateRole.mutate({
                  userId: row.original.userId,
                  input: { role: key as (typeof TENANT_ROLES)[number] },
                })
              }
              className="max-w-[12rem]"
              data-testid={`member-role-${row.original.userId}`}
            />
          ) : (
            <Badge>{t(`feature.admin.members.role.${row.original.role}`)}</Badge>
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("feature.admin.members.column.actions")}</span>,
        cell: ({ row }) =>
          canRemove ? (
            <Button
              variant="outline"
              size="sm"
              onPress={() => setRemoving(row.original)}
              data-testid={`member-remove-${row.original.userId}`}
            >
              {t("feature.admin.members.remove")}
            </Button>
          ) : null,
      },
    ],
    [t, roleItems, canUpdate, canRemove, updateRole]
  );

  return (
    <section data-testid="admin-members">
      <AdminSectionHeader
        heading={t("feature.admin.members.title")}
        description={t("feature.admin.members.description")}
        action={
          canInvite ? (
            <Button onPress={() => setInviteOpen(true)} data-testid="member-invite-open">
              {t("feature.admin.members.invite")}
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <LoadingState message={t("auth.status.loading")} />
      ) : isError ? (
        <AdminQueryError error={error} onRetry={() => void refetch()} />
      ) : !data || data.members.length === 0 ? (
        <EmptyState title={t("feature.admin.members.empty")} />
      ) : (
        <Card>
          <CardBody>
            <DataTable data={data.members} columns={columns} rowTestId="member-row" />
          </CardBody>
        </Card>
      )}

      {data && data.pendingInvitations.length > 0 && (
        <div className="mt-6" data-testid="member-pending">
          <h2 className="mb-2 text-sm font-semibold text-fg">
            {t("feature.admin.members.pendingTitle")}
          </h2>
          <ul className="space-y-1 text-sm text-fg-muted">
            {data.pendingInvitations.map((inv) => (
              <li key={inv.email}>
                {inv.email} — {t(`feature.admin.members.role.${inv.role}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <LiveRegion tone="polite" className="mt-2 text-sm text-success" data-testid="members-status">
        {updateRole.isSuccess || remove.isSuccess ? t("feature.admin.members.saved") : ""}
      </LiveRegion>

      {inviteOpen && (
        <InviteMemberDialog roleItems={roleItems} onClose={() => setInviteOpen(false)} />
      )}

      {removing && (
        <Dialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
          aria-label={t("feature.admin.members.removeConfirmTitle")}
        >
          <h2 className="text-base font-semibold text-fg">
            {t("feature.admin.members.removeConfirmTitle")}
          </h2>
          <p className="mt-2 text-sm text-fg-muted">
            {t("feature.admin.members.removeConfirmBody", { name: removing.displayName })}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onPress={() => setRemoving(null)}>
              {t("feature.admin.members.cancel")}
            </Button>
            <Button
              size="sm"
              isDisabled={remove.isPending}
              onPress={() => remove.mutate(removing.userId, { onSuccess: () => setRemoving(null) })}
              data-testid="member-remove-confirm"
            >
              {t("feature.admin.members.remove")}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function InviteMemberDialog({
  roleItems,
  onClose,
}: {
  roleItems: SelectItem[];
  onClose: () => void;
}) {
  const t = useTranslation();
  const invite = useInviteMember();
  const { control, handleSubmit } = useForm<InviteMemberRequest>({
    resolver: zodResolver(InviteMemberRequestSchema),
    defaultValues: { email: "", role: "member" },
  });

  function onSubmit(values: InviteMemberRequest) {
    invite.mutate(values, { onSuccess: onClose });
  }

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      aria-label={t("feature.admin.members.invite")}
    >
      <h2 className="text-base font-semibold text-fg">{t("feature.admin.members.invite")}</h2>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-4 space-y-4"
        data-testid="member-invite-form"
      >
        <Controller
          name="email"
          control={control}
          render={({ field, fieldState }) => (
            <FormField
              label={t("feature.admin.members.emailLabel")}
              type="email"
              value={field.value ?? ""}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              isInvalid={!!fieldState.error}
              errorMessage={fieldState.error?.message}
              inputProps={{ "data-testid": "member-invite-email" }}
            />
          )}
        />
        <Controller
          name="role"
          control={control}
          render={({ field }) => (
            <Select
              items={roleItems}
              placeholder={t("feature.admin.members.roleLabel")}
              aria-label={t("feature.admin.members.roleLabel")}
              selectedKey={field.value}
              onSelectionChange={(key) => field.onChange(String(key))}
              data-testid="member-invite-role"
            />
          )}
        />
        {invite.isError && (
          <p role="alert" className="text-sm text-danger" data-testid="member-invite-error">
            {t("feature.admin.members.inviteError")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" type="button" onPress={onClose}>
            {t("feature.admin.members.cancel")}
          </Button>
          <Button
            size="sm"
            type="submit"
            isDisabled={invite.isPending}
            data-testid="member-invite-submit"
          >
            {t("feature.admin.members.invite")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
