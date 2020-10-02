const core = require('@actions/core');
const github = require('@actions/github');
const get = require('lodash/get');

async function run() {
  try {
    const trigger = core.getInput('tigger');
    const commentMsg = get(github, 'context.payload.comment.body', '');

    if (!commentMsg.includes(trigger)) {
      core.info('Trigger not found');
      core.setOutput('isTriggered', 'false');
      return null;
    }

    core.setOutput('isTriggered', 'true');
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
