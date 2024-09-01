# slack-merge-queue

handles a merge queue with github actions and slack.

> NOTE: smarthost has taken stewardship of the repository and transferred from `lwhiteley/slack-merge-queue`
> The last version under the previous owner is `lwhiteley/slack-merge-queue@v3`

## Setup

### Step 1: Create a slack web api bot

Create a slack api bot via https://api.slack.com/apps

then setup the following permissions

**Base required scopes:**

- [chat:write.customize](https://api.slack.com/scopes/chat:write.customize)
- [users:read.email](https://api.slack.com/scopes/users:read.email)
- [incoming-webhook](https://api.slack.com/scopes/incoming-webhook): should be enabled when the bot is added to a channel

**Methods used and their scopes:**

Please see each method's required scopes and add them to your slack bot token. If a new method is used with a new set of scopes, this will typically be a breaking change

Methods:

- [users.info](https://api.slack.com/methods/users.info)
- [conversations.members](https://api.slack.com/methods/conversations.members)
- [conversations.list](https://api.slack.com/methods/conversations.list)
- [conversations.history](https://api.slack.com/methods/conversations.history)
- [conversations.replies](https://api.slack.com/methods/conversations.replies)
- [chat.postMessage](https://api.slack.com/methods/chat.postMessage)
- [chat.update](https://api.slack.com/methods/chat.update)
- [chat.delete](https://api.slack.com/methods/chat.delete)

### Step 2: Install bot to channel.

Once the bot is setup, install the bot to your desired channel.

NB:

- For private channels (or additional private channels), the bot (App) must be added to the channel

### Step 3: Create github secret

create a github secret with name `SLACK_TOKEN` and its value the `Bot User OAuth Access Token`.

### Step 4: Add build configs

Add the actions to your workflow. ensure the modes are used correctly as explained in the `Modes` section.

## Modes

There are various modes to achieve the different actions to manage the queue. These are:

### INIT

This mode is responsible for adding a pull request to the slack queue. You can do this by commenting on a pull request with the `init_trigger` (default: `/merging`). For this mode to work, ensure this piece of your workflow is merged to the main branch of your repository.

sample:

```yaml
name: sample-add-to-q

on:
  issue_comment:
    types: [created, edited]
  pull_request_review:
    types: [submitted, edited]

jobs:
  add_to_queue:
    env:
      SLACK_TOKEN: ${{ secrets.SLACK_TOKEN }}
    runs-on: ubuntu-latest
    name: Add PR to queue
    steps:
      - name: Add PR to queue
        uses: lwhiteley/slack-merge-queue@v3
        id: add_to_q
        with:
          mode: 'INIT'
          channel: 'merge-queue'
          init_trigger: '/merging'
      # Use the output from the `add_to_q` step
      - name: Get the output
        run: echo "status => ${{ steps.add_to_q.outputs.status }}"
```

Additionally, you can set slack users to be notified by using a `notify:` tag in the comment on a new line. This is a comma seperated list of user references. The user reference can be the:

- slack member id
- slack member's full name
- slack display name
- slack username
- email username portion (eg. _**john.doe**_@smq.com)

Please note that these references are case sensitive

eg.

```
/merging
notify: U024BE7LH, Max Musterman, Mark, jim.j, john.doe
```

**Tips:**

- You can update the `notify:` list in slack by editing an existing `INIT` comment.
  - Only the watchers list can be updated by a comment change once a pull request is in the queue.
- If your slack username is the same as your github username then you will be automatically notified without specifying the `notify` list. This includes assignees and all other users associated with the pull request and comment made (except reviewers list)
  - github usernames will be lowercased to match slack requirements

### CANCEL

This mode manually sets the status of a PR in the queue to `CANCELLED` without needing to close a pull request. This can be considered a temporary cancel. To trigger this mode a comment can be made on the pull request with the desired or default trigger phrase.

eg. trigger cancel and override `delete_on_cancel` option

```
/cancel-merge
delete_on_cancel: true
```

**Actions taken:**

- It will change the `Queue Status` from `MERGING` to `CANCELLED`.
- It will send a message to alert the next pull request in the queue when the current pull request is cancelled. Alert is only sent if the next PR is the next in line to be merged.
- if configured, will delete message thread after cancel complete

sample:

```yaml
name: sample_cancel_in_queue

on:
  issue_comment:
    types: [created]
  pull_request_review:
    types: [submitted]

jobs:
  add_to_queue:
    env: # Or as an environment variable
      SLACK_TOKEN: ${{ secrets.SLACK_TOKEN }}
    runs-on: ubuntu-latest
    name: Cancel PR in queue
    steps:
      - name: Cancel PR in queue
        uses: lwhiteley/slack-merge-queue@v3
        id: cancel_pr
        with:
          mode: 'CANCEL'
          channel: 'merge-queue'
          cancel_trigger: '/cancel-merge'
          cancel_ready_message: 'Previous PR merge was temporarily cancelled. This PR is now up for merge!'
          # delete_on_cancel: 'true' # uncomment if you want to delete cancelled prs from queue
      # Use the output from the `cancel_pr` step
      - name: Get the output
        run: echo "status => ${{ steps.cancel_pr.outputs.status }}"
      - name: Get the next PR number
        run: echo "next pr => ${{ steps.cancel_pr.outputs.next_pr }}"
```

### MERGE

This mode updates the slack message of the current pull request.

**Actions taken:**

- It will change the `Queue Status` from `MERGING` to either `CANCELLED` or `MERGED` for current PR.
- It will send a message to alert the next Pull request in the queue when the current pull request is closed/merged.
- If a PR is merged ahead of one currently up for merge, The unmerged PR(s) will be marked as `STALE`. They can be added to the queue again by re-triggering the `INIT` mode.
- if configured, will delete message thread after cancel complete

sample:

```yaml
name: sample_update_queue

on:
  pull_request:
    types: [closed]

jobs:
  update_q_on_close:
    env:
      SLACK_TOKEN: ${{ secrets.SLACK_TOKEN }}
    runs-on: ubuntu-latest
    name: Update Queue
    steps:
      - name: Update queue
        uses: lwhiteley/slack-merge-queue@v3
        id: update_q_on_close
        with:
          mode: 'MERGE'
          channel: 'merge-queue'
          merge_ready_message: 'Last PR closed. This PR is now up for merge!'
          # delete_on_cancel: 'true' # uncomment if you want to delete cancelled prs from queue
      # Use the output from the `update_q_on_close` step
      - name: Get the output status
        run: echo "status => ${{ steps.update_q_on_close.outputs.status }}"
      - name: Get the next PR number
        run: echo "next pr => ${{ steps.update_q_on_close.outputs.next_pr }}"
```

### ALERT

This mode alerts the current pull request in the queue by adding a message to its thread.
Typically this can be used to alert the thread when the build/workflow is complete but can be used at any point in the build process based on your use case.
If used to alert when the build is complete, ensure the proper dependencies are set to ensure the job is run last or close to last as a post build step.

simple example:

- [pr-build-complete.yml](.github/workflows/pr-build-complete.yml)

workflow completed example:

- [pr-build-complete-wait.yml](.github/workflows/pr-build-complete-wait.yml)
- [dummy-build.yml](.github/workflows/dummy-build.yml)

```yaml
name: sample_alert_current

on:
  workflow_run:
    # will trigger alert for each workflow listed
    workflows: ['mock-workflow']
    types:
      - completed

jobs:
  alert_current_pr:
    env:
      SLACK_TOKEN: ${{ secrets.SLACK_TOKEN }}
    runs-on: ubuntu-latest
    name: Alert Current in Queue
    steps:
      - name: Alert queue
        uses: lwhiteley/slack-merge-queue@v3
        id: alert
        with:
          mode: 'ALERT'
          channel: 'merge-queue'
          # the following variables are only available in 'workflow_run' event
          alert_message: '`${{ github.event.workflow.name }}` is complete with status `${{ github.event.workflow_run.conclusion }}`!'
      # Use the output from the `alert` step
      - name: Get the output status
        run: echo "status => ${{ steps.alert.outputs.status }}"
```

## Build Failure Policy

- Invalid required inputs will fail the build
- Process errors will not fail the build
  - A status will be given along with an error log

## API Documentation

### Queue Tag

The queue tag is sent by the `INIT` mode.

Pattern: `[Search Prefix] :: [PR number] :: [Queue Status] :: [PR link]`

eg.

`Q-PR :: 3 :: MERGED :: chore: add package keyword`

| Section       | Description                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search Prefix | Critical piece used to search for queue tags within the channel. It is important that non-queue messages within the channel do not start with the sub string `Q-PR` |
| PR number     | The pull request number                                                                                                                                             |
| Queue Status  | The status of the pull request in the queue. <br/><br/> **enum**: `MERGING`, `CANCELLED`, `MERGED`, `STALE`                                                         |
| PR link       | A link to the pull request page. The text for the link is the pull request title                                                                                    |

### Action Inputs

| Input                | Modes         | Description                                                                                                                                                                                                                            |
| -------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mode                 | \_\_\_        | Required input to tell the GH Action what mode to run. An invalid mode will fail the build. <br/><br/> **enum**: `INIT`, `CANCEL`, `MERGE`, `ALERT` <br/> **required:** `true`                                                         |
| channel              | _ALL_         | The slack channel to use as the merge queue. Can specify channel id or name. Will not be used if `channel_id` is specified. Build will fail if the channel cannot be found <br/> **required:** `true (if channel_id is not specified)` |
| channel_id           | _ALL_         | The slack channel id to use as the merge queue. If specified, the action will skip a channel lookup and proceed to use the channel id for further operations. <br/> **required:** `false`                                              |
| team_id              | _ALL_         | encoded [Slack team id](https://www.alphr.com/slack-find-team-id/) to list channels in, required if token belongs to org-wide app eg. `T1234567890` <br/> **default:** _undefined_                                                     |
| icon_emoji           | _ALL_         | A slack emoji to use as the bot's avatar <br/> **default:** `:robot_face:`                                                                                                                                                             |
| history_threshold    | _ALL_         | The history threshold will stop looking up messages after the specified number of messages found do not have the 'MERGING' status <br/> **default:** `10`                                                                              |
| channel_types        | _ALL_         | Mix and match channel types by providing a comma-separated list of any combination of `public_channel`, `private_channel`, `mpim`, `im` <br/> **default:** `public_channel,private_channel`                                            |
| init_trigger         | INIT          | The trigger text for adding a PR to the merge queue. <br/> **default:** `/merging`                                                                                                                                                     |
| cancel_trigger       | CANCEL        | The trigger text for cancelling a PR in the merge queue. <br/> **default:** `/cancel-merge`                                                                                                                                            |
| cancel_ready_message | CANCEL        | Message to be sent to the next PR in the queue after a cancel is complete <br/> **default:** `Previous PR merge was temporarily cancelled. This PR is now up for merge!`                                                               |
| merge_ready_message  | MERGE         | Message to be sent to the next PR in the queue after a merge/cancel occurs <br/> **default:** `Last PR closed. This PR is now up for merge!`                                                                                           |
| alert_message        | ALERT         | Message to be sent to the current PR in the queue <br/> **default:** `build is complete. Time to merge!`                                                                                                                               |
| only_when_current    | ALERT         | When `true`, will only send an alert to a PR in slack if it is currently up for merge. <br/> **enum:** `true`, `false` <br/> **default:** `true`                                                                                       |
| auto_notify          | INIT          | When `true`, will automatically notify any related github users to the pull request. <br/> **enum:** `true`, `false` <br/> **default:** `true`                                                                                         |
| delete_on_cancel     | MERGE, CANCEL | When `true`, will delete a queue item when cancelled. <br/> **enum:** `true`, `false` <br/> **default:** `false`                                                                                                                       |

### Action Outputs

| Output    | Modes         | Description                                                                                                                                                   |
| --------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| status    | _ALL_         | The status of the build run to give an insight into what has happened. These can be useful for taking additional actions in a workflow                        |
| triggered | INIT, CANCEL  | This is a boolean string which is set to `true` only if the correct trigger phrase is commented for an open pull request. <br/><br/>**enum:** `true`, `false` |
| next_pr   | MERGE, CANCEL | this is the `PR number` for the next pull request in the queue.                                                                                               |

#### `status` Output Details

| Status            | Modes                | Description                                                                                  |
| ----------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| ALREADY_CLOSED    | INIT, CANCEL         | exported when the trigger is used but the pull request is already in a closed state.         |
| TRIGGER_NOT_FOUND | INIT, CANCEL         | exported if a pull request comment does not contain the desired trigger                      |
| WATCHERS_UPDATED  | INIT                 | exported when a PR is already in the queue but watchers list has been updated                |
| ALREADY_QUEUED    | INIT                 | exported when a PR is already added to the slack queue                                       |
| ADDED_TO_QUEUE    | INIT                 | exported when the pull request has been added to the slack queue                             |
| NOT_FOUND         | ALERT, MERGE, CANCEL | exported when a queue tag is not found in slack                                              |
| COMPLETED         | ALERT                | exported when an unspecific action is complete. one such action is the generic alert action. |
| CANCELLED         | MERGE, CANCEL        | exported when the build tag status has been updated to cancelled                             |
| MERGED            | MERGE                | exported when the build tag status has been updated to merged                                |
| FAILED            | _ALL_                | When any failure occurs then this status will be set for all modes                           |

## Samples

![thread](images/smq-thread.png)

## Notes

- Pull requests are welcome!

## License

Apache 2.0
