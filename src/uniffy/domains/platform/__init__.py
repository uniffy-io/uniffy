"""Platform operator domain.

Houses the cross-tenant operator surfaces under ``superadmin.v1``:

* ``directory`` -- organizations + users index for ``/platform/{orgs,users}``.
* ``support_session`` (future) -- time-bound owner-consented access grants.

Every operation in this slice is gated on ``User.is_system_admin=true``
and never bypasses :class:`PermissionChecker` for tenant content.
"""
