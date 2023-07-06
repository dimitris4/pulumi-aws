# pulumi-aws

Set up and configure Pulumi to access your AWS account.

Download the Pulumi CLI from the Pulumi website and installed it on my machine.
Sign up for a Pulumi Cloud account. 

To log in to your Pulumi account, I use the command pulumi login.

Create an AWS account

Using the AWS CLI, I created a shared credentials file. The user credentials are saved in the /.aws/credentials file.

By running the command pulumi new aws-typescript, create a new Pulumi project that uses the AWS and TypeScript templates.

Run pulumi up to create the resources on AWS, and pulumi destroy to clean up.
