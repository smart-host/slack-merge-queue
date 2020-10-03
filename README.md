# slack-merge-queue

handles a merge queue with github actions

Sample build config

Mode: `INIT`

```yaml
name: sample-add-to-q

on:
  issue_comment:
    types: [created, edited]

jobs:
  add_to_queue:
    env:
      SLACK_TOKEN: ${{ secrets.SLACK_TOKEN }}
    runs-on: ubuntu-latest
    name: Add PR to queue
    steps:
      - name: Add PR to queue
        uses: lwhiteley/slack-merge-queue@{version}
        id: add_to_q
        with:
          init_trigger: '/merging'
          channel: 'merge-queue'
      # Use the output from the `add_to_q` step
      - name: Get the output
        run: echo "status => ${{ steps.add_to_q.outputs.status }}"
```
