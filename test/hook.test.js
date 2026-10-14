import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'bin', 'cxm.js');

function runHook(name, payload) {
  return spawnSync(process.execPath, [bin, 'hook', name], { input: JSON.stringify(payload), encoding: 'utf8' });
}

test('Codex apply_patch Terraform edit emits the same cost context', () => {
  const result = runHook('iac-cost', {
    tool_input: {
      command: '*** Begin Patch\n*** Update File: main.tf\n@@\n resource "aws_instance" "web" {\n+  instance_type = "m5.large"\n }\n*** End Patch',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /m5\.large/);
  assert.match(result.stdout, /PostToolUse/);
});

test('Claude Edit payload continues to emit cost context', () => {
  const result = runHook('iac-cost', {
    tool_input: { file_path: 'main.tf', new_string: 'instance_type = "m5.large"\nregion = "eu-west-3"' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /m5\.large/);
  assert.match(result.stdout, /eu-west-3/);
});

test('Codex apply_patch CloudFormation edit emits cost context', () => {
  const result = runHook('iac-cost', {
    tool_input: {
      command:
        '*** Begin Patch\n*** Add File: stack.yaml\n+AWSTemplateFormatVersion: "2010-09-09"\n+Resources:\n+  Web:\n+    Type: AWS::EC2::Instance\n+    Properties:\n+      InstanceType: c6i.xlarge\n*** End Patch',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /c6i\.xlarge/);
  assert.match(result.stdout, /CloudFormation/);
});

test('irrelevant Codex patches stay silent and aws commands still nudge', () => {
  const patch = runHook('iac-cost', { tool_input: { command: '*** Begin Patch\n*** Update File: README.md\n+hello\n*** End Patch' } });
  assert.equal(patch.stdout, '');
  const aws = runHook('aws-cost', { tool_input: { command: 'aws ec2 run-instances --instance-type m5.large' } });
  assert.match(aws.stdout, /CloudExMachina/);
});

test('a non-IaC Claude edit stays silent', () => {
  const result = runHook('iac-cost', { tool_input: { file_path: 'src/app.js', new_string: 'const x = 1;' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
