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
import { AuditTrailPanel } from "../admin/AuditTrailPanel";
import {
  useMembers,
  useInviteMember,
  useUpdateMemberRole,
  useRemoveMember,
  useEditUsername,
  useSetMemberStatus,
  useResendInvite,
  useExternalIdentities,
} from "./use-admin-members";

const statusVariant: Record<MemberSummary["status"], "default" | "secondary"> = {
  active: "default",
  invited: "secondary",
  disabled: "secondary",
};

/**
 * Members section (ADR-0036, ADR-ACT-0206). Tenant-scoped identity: username,
 * lifecycle status, last login. Invite / change-role / remove are preserved; an
 * expandable detail row edits the username, enables/disables the member, and lists
 * linked external identities. Mutations are re-authorised by the BFF; the last-admin
 * guard lives server-side; write controls are hidden for readers.
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
        id: "expand",
        header: () => <span className="sr-only">{t("feature.admin.members.column.details")}</span>,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={row.getIsExpanded()}
            aria-label={t("feature.admin.members.toggleDetails")}
            onPress={() => row.toggleExpanded()}
            data-testid={`member-expand-${row.original.userId}`}
          >
            <span aria-hidden="true">{row.getIsExpanded() ? "▾" : "▸"}</span>
          </Button>
        ),
      },
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
        id: "username",
        header: () => t("feature.admin.members.column.username"),
        cell: ({ row }) => (
          <span
            className="font-mono text-sm"
            data-testid={`member-username-${row.original.userId}`}
          >
            {row.original.username ?? t("feature.admin.members.noUsername")}
          </span>
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
              className="max-w-[11rem]"
              data-testid={`member-role-${row.original.userId}`}
            />
          ) : (
            <Badge>{t(`feature.admin.members.role.${row.original.role}`)}</Badge>
          ),
      },
      {
        id: "status",
        header: () => t("feature.admin.members.column.status"),
        cell: ({ row }) => (
          <Badge
            variant={statusVariant[row.original.status]}
            data-testid={`member-status-${row.original.userId}`}
          >
            {t(`feature.admin.members.status.${row.original.status}`)}
          </Badge>
        ),
      },
      {
        id: "lastLogin",
        header: () => t("feature.admin.members.column.lastLogin"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-fg-muted">
            {row.original.lastLoginAt
              ? row.original.lastLoginAt.slice(0, 10)
              : t("feature.admin.members.neverLoggedIn")}
          </span>
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
            <DataTable
              data={data.members}
              columns={columns}
              rowTestId="member-row"
              renderSubComponent={(row) => (
                <MemberDetail member={row.original} canUpdate={canUpdate} />
              )}
            />
          </CardBody>
        </Card>
      )}

      {data && data.pendingInvitations.length > 0 && (
        <PendingInvitations
          invitations={data.pendingInvitations}
          canResend={canInvite}
          roleLabel={(role) => t(`feature.admin.members.role.${role}`)}
        />
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

/** Expandable per-member detail: username edit, enable/disable, external identities. */
function MemberDetail({ member, canUpdate }: { member: MemberSummary; canUpdate: boolean }) {
  const t = useTranslation();
  const editUsername = useEditUsername();
  const setStatus = useSetMemberStatus();
  const externalIds = useExternalIdentities(member.userId, true);
  const [username, setUsername] = useState(member.username ?? "");

  const usernameErr = editUsername.error as { status?: number } | null;
  const nextStatus = member.status === "disabled" ? "active" : "disabled";

  return (
    <div
      className="grid grid-cols-1 gap-6 p-2 sm:grid-cols-2"
      data-testid={`member-detail-${member.userId}`}
    >
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-fg">
          {t("feature.admin.members.usernameLabel")}
        </h3>
        {canUpdate ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              editUsername.mutate({ userId: member.userId, input: { username } });
            }}
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            data-testid={`member-username-form-${member.userId}`}
          >
            <FormField
              aria-label={t("feature.admin.members.usernameLabel")}
              value={username}
              onChange={setUsername}
              inputProps={{ "data-testid": `member-username-input-${member.userId}` }}
            />
            <Button
              type="submit"
              size="sm"
              isDisabled={editUsername.isPending}
              data-testid={`member-username-save-${member.userId}`}
            >
              {t("feature.admin.members.saveUsername")}
            </Button>
          </form>
        ) : (
          <p className="font-mono text-sm text-fg">
            {member.username ?? t("feature.admin.members.noUsername")}
          </p>
        )}
        {editUsername.isError && (
          <p
            role="alert"
            className="text-sm text-danger"
            data-testid={`member-username-error-${member.userId}`}
          >
            {usernameErr?.status === 409
              ? t("feature.admin.members.usernameConflict")
              : t("feature.admin.members.usernameError")}
          </p>
        )}
        {editUsername.isSuccess && (
          <p className="text-sm text-success">{t("feature.admin.members.usernameSaved")}</p>
        )}

        {canUpdate && (
          <div className="pt-2">
            <Button
              variant="outline"
              size="sm"
              isDisabled={setStatus.isPending}
              onPress={() =>
                setStatus.mutate({ userId: member.userId, input: { status: nextStatus } })
              }
              data-testid={`member-status-toggle-${member.userId}`}
            >
              {member.status === "disabled"
                ? t("feature.admin.members.enable")
                : t("feature.admin.members.disable")}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-fg">
          {t("feature.admin.members.externalIdentities")}
        </h3>
        {externalIds.isLoading ? (
          <p className="text-sm text-fg-muted">{t("auth.status.loading")}</p>
        ) : externalIds.isError ? (
          <AdminQueryError error={externalIds.error} />
        ) : (externalIds.data?.identities ?? []).length === 0 ? (
          <p className="text-sm text-fg-muted">{t("feature.admin.members.noExternalIdentities")}</p>
        ) : (
          <ul className="space-y-1 text-sm" data-testid={`member-external-${member.userId}`}>
            {externalIds.data!.identities.map((id) => (
              <li key={id.id} className="text-fg-muted">
                <span className="font-medium text-fg">{id.provider}</span> ·{" "}
                {id.email ?? id.subject}
              </li>
            ))}
          </ul>
        )}
        <div className="pt-4">
          <AuditTrailPanel
            resource="member"
            resourceId={member.userId}
            heading={t("feature.admin.members.recentActivity")}
            testId={`member-audit-${member.userId}`}
          />
        </div>
      </div>
    </div>
  );
}

function PendingInvitations({
  invitations,
  canResend,
  roleLabel,
}: {
  invitations: { email: string; role: MemberSummary["role"] }[];
  canResend: boolean;
  roleLabel: (role: MemberSummary["role"]) => string;
}) {
  const t = useTranslation();
  const resend = useResendInvite();
  return (
    <div className="mt-6" data-testid="member-pending">
      <h2 className="mb-2 text-sm font-semibold text-fg">
        {t("feature.admin.members.pendingTitle")}
      </h2>
      <ul className="space-y-1 text-sm text-fg-muted">
        {invitations.map((inv) => (
          <li key={inv.email} className="flex items-center justify-between gap-3">
            <span>
              {inv.email} — {roleLabel(inv.role)}
            </span>
            {canResend && (
              <Button
                variant="ghost"
                size="sm"
                isDisabled={resend.isPending}
                onPress={() => resend.mutate({ email: inv.email })}
                data-testid={`member-resend-${inv.email}`}
              >
                {t("feature.admin.members.resend")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <LiveRegion
        tone="polite"
        className="mt-1 text-sm text-success"
        data-testid="member-resend-status"
      >
        {resend.isSuccess ? t("feature.admin.members.resendSent") : ""}
      </LiveRegion>
    </div>
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
