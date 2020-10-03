# merge-queue-init

handles a merge queue with github actions

Sample build config

```yaml
name: sample-add-to-q

on:
  issue_comment:
    types: [created, edited]

jobs:
  add_to_queue:
    env: # Or as an environment variable
      SLACK_TOKEN: ${{ secrets.SLACK_TOKEN }}
      SLACK_CLIENT_ID: ${{ secrets.SLACK_CLIENT_ID }}
      SLACK_CLIENT_SECRET: ${{ secrets.SLACK_CLIENT_SECRET }}
    runs-on: ubuntu-latest
    name: Add PR to queue
    steps:
      - name: Add PR to queue
        uses: lwhiteley/merge-queue-init@{version} # Uses an action in the root directory
        id: add_to_q
        with:
          trigger: '/merging'
          channel: 'merge-queue'
      # Use the output from the `add_to_q` step
      - name: Get the output
        run: echo "status => ${{ steps.add_to_q.outputs.status }}"
```

Related Actions:

- merge-queue-complete
