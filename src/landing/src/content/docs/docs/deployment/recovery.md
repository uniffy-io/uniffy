---
title: Account Recovery
description: Disable two factor authentication on a user account when no admin can perform the reset from inside the app. Self hosted only, command line, audit logged. Also what happens to edits not yet saved when Valkey restarts.
sidebar:
  label: Account Recovery
  order: 11
---

When a user loses their authenticator and there is nobody left who can reset two factor authentication from inside the app, you can disable it with a single command on the host running Uniffy. This page is for self hosted operators. The command does not exist on the hosted product.

The reset removes the user's two factor enrollment and every recovery code, bumps the user's token version so any live session is killed, and writes an audit row tagged `break_glass` with the reason you provide. The user can sign in with their password on the next attempt and will be guided through fresh two factor enrollment.

## When to use this

There is a chain of recovery paths inside the app. Try them in order before reaching for the command line.

The user's own recovery codes come first. Anyone who enrolls two factor authentication is shown ten one time codes once and only once. If they kept them, they sign in with one and regenerate the rest from their account settings.

An organization admin reset comes next. Any user with `ADMIN` or `OWNER` role on the organization can clear two factor authentication on any member from the members page. The target is signed out everywhere and walks through fresh enrollment on the next sign in.

A platform admin reset comes after that, and only when the target has zero organization memberships. Platform admins cannot reset two factor authentication on tenant users. If the target is themselves a platform admin, a second platform admin co signs the reset within a ten minute window.

The command on this page is the path of last resort. Use it when every admin who could perform an in app reset has also lost their device, or when the deployment has a single owner and that single owner is locked out. Document the reason. The audit row will outlive your shell session.

## Enable the command

The command is gated behind an environment variable so it does not exist in containers that do not need it. Set `ENABLE_BREAK_GLASS_CLI=1` on the backend before invoking it. Anything else (empty, `0`, missing) refuses to run and exits with status 2.

Set the variable inline for the single invocation. Do not bake it into the image and do not commit it to your deployment manifests. The whole point is that you have to consciously enable it.

## Kubernetes

In Kubernetes you exec into a running backend pod. Pick any one. They all share the same database and the reset is a single transaction.

```bash
kubectl exec \
  -n uniffy \
  -it deploy/uniffy-backend \
  -- env ENABLE_BREAK_GLASS_CLI=1 \
       python -m uniffy --mfa-reset \
         --user-email alice@example.com \
         --reason "device lost, ticketed as INC-4821"
```

The `env` shim sets the variable for the single command without touching the pod's environment. Replace the namespace and deployment name with what you use. Pass `--yes` to skip the confirmation prompt if you are running this from a script or a runbook automation.

If the deployment is unhealthy and no backend pod is ready to exec into, run a one shot Job with the same image and config.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: uniffy-mfa-reset
  namespace: uniffy
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: reset
          image: ghcr.io/uniffy-io/uniffy:latest
          envFrom:
            - secretRef:
                name: uniffy-backend-env
          env:
            - name: ENABLE_BREAK_GLASS_CLI
              value: "1"
          args:
            - python
            - -m
            - uniffy
            - --mfa-reset
            - --user-email
            - alice@example.com
            - --reason
            - "device lost, ticketed as INC-4821"
            - --yes
```

Apply with `kubectl apply -f reset-job.yaml`, read the logs with `kubectl logs -n uniffy job/uniffy-mfa-reset`, and delete the manifest or the secret reference afterward so the email and reason do not linger in your version control. The `ttlSecondsAfterFinished` cleans the job up automatically ten minutes after it completes.

The `envFrom` block should reference whatever secret your backend deployment already uses for its environment. The point is that the one shot Job sees the same database and master key the backend sees, so the reset writes to the right database.

## What the command does

The command opens a database session, finds the user by email, deletes the two factor secret row, deletes every recovery code row, increments the user's token version, writes one audit row with the action `auth.mfa_break_glass_reset`, and commits. There is no separate flush step. Either the whole change lands or none of it does.

The audit row is the forensic record. It carries the target user id, the target email, the reason text you supplied, and a timestamp. The `actor_user_id` field is null on purpose. There is no signed in user when the command runs. The reason field is your accountability.

The token version bump and the revoked sessions land in the same commit. Every request checks those facts in PostgreSQL, so every access token the user holds is rejected from the next request on, and open live editing connections close within thirty seconds. They are signed out cluster wide. The next sign in is a fresh start.

## After the reset

The user signs in with their password. The login flow sees that they have no two factor enrollment and, depending on the organization and platform policy, either lets them in directly or routes them through fresh two factor enrollment. They are shown a new set of ten recovery codes once. The old ten are dead, hashed in a deleted row, and unrecoverable.

If the user was a platform admin and the deployment policy requires two factor authentication for platform admins, fresh enrollment is mandatory. The user cannot reach any platform page until they finish.

Tell the user what you did and why. The out of band email that org admin and platform admin resets send is not sent for break glass resets. The user will see "two factor was reset" on the audit log later, but a heads up from you is the right courtesy.

## Disable the command afterward

Unset `ENABLE_BREAK_GLASS_CLI` or remove the env file entry. The command should not be reachable by accident. If you used a one shot Job, delete the manifest. If you used `kubectl exec`, the inline env value is already gone with the shell.

The shell history is the other place to clean up. The reason text often contains a ticket number or a brief description, neither of which need to live in your shell history forever. `history -d` on bash or the equivalent on your shell of choice.

## What this command will not do

It will not reset a password. Use the password reset flow in the app for that.

It will not unsuspend a user account or undelete an organization. Those are separate platform admin actions with their own audit trails.

It will not recover lost notes, lost files, or any other content. Two factor authentication is the door, not the room.

It will not work if the database is unreachable or the master key is missing. The reset writes to the same database the backend uses, and the audit row goes through the same writer the rest of the app uses. If the backend cannot start, this command cannot run either.

If your last admin has lost their device, your master key is intact, and your database is reachable, this command gets them back in. That is the whole scope.

## Unsaved edits after a Valkey restart

Live edits wait in Valkey for a few seconds before Uniffy saves them to PostgreSQL. A Valkey restart needs no command from you, with or without persistence. This is what happens.

Every restart gives Valkey a new identity, even when persistence kept every key. Uniffy ties each document's waiting edits to the identity that accepted them, so it never mistakes a restarted instance for the old one. On the next touch of a document, Uniffy saves the unbroken run of edits the restarted Valkey still holds and starts a fresh buffer for that document. A touch is an edit, someone opening the document, a write through the API, a save job, or the maintenance pass that runs each minute and works through every document with keys left in Valkey.

Editors notice the fresh buffer and send again every edit the server has not saved. Open editors do it at once. A closed editor does it the next time its author opens Uniffy on that device. While Valkey is down, people keep typing, their chip reads Saving unavailable, and collaborators stop seeing each other's new edits until it is back.

Each backend and worker logs `Valkey instance changed` with the old and new identity, and `uniffy_realtime_buffer_epoch_resets_total` counts the fresh buffers by reason. `uninitialized` is a document starting a fresh buffer and is routine. That happens the first time someone opens or edits it live, on the first touch after an hour without edits freed its buffer, and on the first touch after its content was replaced. `identity_changed` is the restart. `missing_control`, `stale_tail` and `gap` mean keys disappeared or went back in time while Valkey kept running.

### Planned Valkey maintenance

Restarting or upgrading Valkey with its persistence intact loses nothing. Wiping its data is different. The server's copy of every waiting edit goes with it, so save those edits to PostgreSQL first.

Stop the backend pods so no new edits arrive, and keep the core workers running. Then run the checkpoint command once from a core worker pod. It uses the database and Valkey settings of the pod it runs in.

```bash
kubectl exec -n uniffy deploy/uniffy-worker-core \
  -- python -m uniffy --realtime-checkpoint-now
```

The command saves every document that still has edits waiting in Valkey, including documents the regular save schedule lost track of. It prints how many documents it saved and how many edits that covered. It also counts the waiting buffers of documents that were replaced or deleted since, and clears them. Connection settings and credentials never appear in the report.

The exit status is 0 only when nothing is left behind. Otherwise the report lists every buffer it could not save, with the organization, content type and document id, a reason, and the records left.

`pending` means edits arrived while it ran. Make sure every backend pod is stopped and run it again.

`gap` and `stale` mean Uniffy could not prove that buffer complete. It saved the unbroken run it could prove. The rest stays only for investigation, and maintenance drops it after seven days.

`malformed` and `undecodable` mean a stored edit cannot be read. Its bytes stay in Valkey and the document keeps retrying.

Any other reason means the command could not finish that document. Run it again.

Wiping while lines remain removes those records from the server. Editors that never saw those edits saved still hold them on the device and send them again when their authors next open Uniffy.

Confirm on the core worker metrics that `uniffy_realtime_buffer_oldest_pending_seconds` reads 0. That gauge only sees documents on the save schedule, which is why the command comes first. Do not wait on `uniffy_realtime_buffer_pending_records` instead. After keys disappear it also counts the edits Uniffy keeps for investigation for up to seven days, and no save clears those. Then wipe Valkey and start the backends again. Editors keep their unsaved edits on the device in the meantime and send them when the backends return.

Never restore or delete Uniffy's keys inside a running Valkey. Load a different data set only by restarting Valkey, so it gets a new identity. If keys vanish while it keeps running, Uniffy notices on the next touch and starts that document afresh, but edits that lived only in those keys are gone from the server.
