import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC with public and private subnets
    const vpc = new ec2.Vpc(this, 'AppVPC', {
      maxAzs: 2,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // Create Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'AppALB', {
      vpc,
      internetFacing: true,
      ipAddressType: elbv2.IpAddressType.DUAL_STACK, // Enable IPv6
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // Create HTTPS Listener
    const httpsListener = alb.addListener('HttpsListener', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [/* Add your ACM certificate ARN here */],
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Access denied',
      }),
    });

    // Create IAM role for EC2 instances
    const ec2Role = new iam.Role(this, 'EC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    // Add required policies (adjust as needed)
    ec2Role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'));
    ec2Role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCloudWatchAgentServerPolicy'));

    // Create Launch Template
    const launchTemplate = new ec2.LaunchTemplate(this, 'AppLaunchTemplate', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      userData: ec2.UserData.forLinux(),
      role: ec2Role,
    });

    // Add user data script
    const userData = launchTemplate.userData;
    userData.addCommands(
      'yum update -y',
      'yum install -y nodejs npm git',
      'cd /home/ec2-user',
      'git clone YOUR_REPOSITORY_URL',
      'cd YOUR_APP_DIRECTORY',
      'npm install',
      'npm run build', // if you have a build step
      'npm start'
    );

    // Create Auto Scaling Group
    const asg = new autoscaling.AutoScalingGroup(this, 'AppASG', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      launchTemplate: launchTemplate,
      minCapacity: 2,
      maxCapacity: 4,
      desiredCapacity: 2,
      healthCheck: autoscaling.HealthCheck.elb({ grace: cdk.Duration.seconds(60) }),
    });

    // Add scaling policies
    asg.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
    });

    // Add ASG to ALB target group
    httpsListener.addTargets('AppTarget', {
      port: 3000, // Your application port
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [asg],
      healthCheck: {
        path: '/health', // Add a health check endpoint to your application
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
      },
    });

    // Output the ALB DNS name
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
    });
  }
} 