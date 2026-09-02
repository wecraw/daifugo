# Deploy

One Cloud Run service, one Cloud Build trigger on `main`, one GCP project
(§13.1, §14.1). There is no dev environment: `npm run dev` runs the stack against
the Firestore emulator, and that covers the dev case.

The recurring deploy is just `git push origin main`. Everything below is either
one-time provisioning or verification.

The pipeline itself is code: [`cloudbuild.yaml`](../cloudbuild.yaml) and
[`Dockerfile`](../Dockerfile) at the repo root. Read the comments in
`cloudbuild.yaml` before changing a runtime flag — three of them are load-bearing
in ways nothing else will tell you about.

## Settings

```bash
export PROJECT_ID=daifugo          # also the Firestore project
export REGION=us-west1
export SERVICE=daifugo
export REPO=daifugo                # Artifact Registry repository
```

These match the defaults baked into `cloudbuild.yaml`. Changing `REGION`,
`SERVICE` or `REPO` means changing the substitutions there too.

## One-time provisioning

### 1. APIs and Firestore

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com --project "$PROJECT_ID"
```

```bash
gcloud firestore databases create --location "$REGION" --type firestore-native --project "$PROJECT_ID"
```

No index configuration to apply: the boot re-arm is a single-field query on
`deadline`, which the automatic index covers (§14).

### 2. Artifact Registry

```bash
gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION" --project "$PROJECT_ID"
```

### 3. Runtime service account

The service reaches Firestore as itself — no key file, no local credentials in
the image. `roles/datastore.user` is the whole grant: no Pub/Sub topic and no
Pub/Sub IAM, because the adapter was cut with the second instance (§14.1).

```bash
gcloud iam service-accounts create daifugo-run --display-name "daifugo Cloud Run runtime" --project "$PROJECT_ID"
```

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:daifugo-run@$PROJECT_ID.iam.gserviceaccount.com" --role roles/datastore.user
```

### 4. Cloud Build service account

The build pushes an image and patches the service, so it needs those two roles
plus the ability to act as the runtime service account.

```bash
export BUILD_SA="$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')-compute@developer.gserviceaccount.com"
```

```bash
for role in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser roles/logging.logWriter; do gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$BUILD_SA" --role "$role"; done
```

### 5. Create the service

`cloudbuild.yaml` deploys with `gcloud run services update`, which patches an
existing service and therefore cannot create one. That is the point — a patch
cannot clobber a setting it forgets to restate — but it means the service has to
exist first, with the settings the pipeline does _not_ restate: the runtime
service account and public access.

Build and push a bootstrap image:

```bash
gcloud builds submit --tag "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/$SERVICE:bootstrap" --project "$PROJECT_ID" .
```

Then create the service:

```bash
gcloud run deploy "$SERVICE" --image "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/$SERVICE:bootstrap" --region "$REGION" --platform managed --service-account "daifugo-run@$PROJECT_ID.iam.gserviceaccount.com" --set-env-vars "FIRESTORE_PROJECT_ID=$PROJECT_ID" --execution-environment gen2 --min-instances 0 --max-instances 1 --no-session-affinity --allow-unauthenticated --project "$PROJECT_ID"
```

### 6. Trigger on `main`

Cloud Build reads the build config from the commit that fires the build, so
`cloudbuild.yaml` must already be on `main` before this trigger points at it.

```bash
gcloud builds triggers create github --name daifugo-deploy-main --repo-owner wecraw --repo-name daifugo --branch-pattern '^main$' --build-config cloudbuild.yaml --project "$PROJECT_ID"
```

If the GitHub repository has not been connected to Cloud Build before, connect it
first in the console (Cloud Build → Triggers → Connect repository); the CLI
cannot complete the OAuth handshake.

## Verifying a deploy

The acceptance bar for the pipeline, in two commands.

```bash
export URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
```

```bash
npm run smoke -- "$URL"
```

`scripts/smoke.mjs` checks `/health`, creates and joins a room (a Firestore
write and read performed by the service's own service account), and then holds a
WebSocket open for 60 seconds with no traffic on it. That last one is the check
worth running: gen2 plus WebSocket-only transport either survives an idle minute
or fails silently at the one-minute mark, and the client is far too late a place
to find out which. `SMOKE_HOLD_SECONDS` overrides the hold.

Then confirm the flags that must not drift are still set — after a _second_
deploy, which is what proves the update patch does not drop them:

```bash
gcloud run services describe "$SERVICE" --region "$REGION" --format yaml | grep -E 'execution-environment|cpu-throttling|maxScale|minScale'
```

The annotations are kebab-case (`run.googleapis.com/execution-environment`), so
grepping for `executionEnvironment` matches nothing and looks like a clean pass.
Expect exactly two lines plus the service-level default:

```text
    run.googleapis.com/maxScale: '20'          # service-level default, not the cap
        autoscaling.knative.dev/maxScale: '1'  # the cap that applies
        run.googleapis.com/execution-environment: gen2
```

Two absences matter as much as those lines. There should be **no** `minScale`
annotation — that is `min-instances=0`. And there should be **no**
`run.googleapis.com/cpu-throttling` annotation — that is throttling left at the
default, which is what we want; read the long note in `cloudbuild.yaml` before
adding `--no-cpu-throttling` back.

Also confirm the patch preserved what it never restates — `cloudbuild.yaml` does
not pass `--service-account`, so this line surviving is the evidence that
`services update` really is a patch:

```bash
gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(spec.template.spec.serviceAccountName)'
```

## Rolling back

Cloud Run keeps every revision, so a rollback is a traffic shift with no rebuild
(§13.2):

```bash
gcloud run revisions list --service "$SERVICE" --region "$REGION" --sort-by '~createTime'
```

```bash
gcloud run services update-traffic "$SERVICE" --region "$REGION" --to-revisions "$GOOD_REVISION=100"
```

The process restarts, so in-flight rooms survive on their Firestore state and
their deadlines are re-armed on boot (§14). Players reconnect with the
`resumeToken` already in localStorage (§8.1).
