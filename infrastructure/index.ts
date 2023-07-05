import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as apigateway from "@pulumi/aws-apigateway";
import * as functions from "./functions";
import {RestAPI} from "@pulumi/aws-apigateway";
import {Output} from "@pulumi/pulumi";
import {UsagePlan} from "@pulumi/aws/apigateway";

let config = new pulumi.Config();

const api: RestAPI = new apigateway.RestAPI("api", {
    routes: [
        {
            path: "/login",
            method: "POST",
            eventHandler: new aws.lambda.CallbackFunction("login-handler", {
                memorySize: 256, // 128, 256MB
                callback: functions.login,
            }),
            apiKeyRequired: true,
        },
        {
            path: "/signup",
            method: "POST",
            eventHandler: new aws.lambda.CallbackFunction("signup-handler", {
                memorySize: 256, // 128, 256MB
                callback: functions.signup,
            }),
            apiKeyRequired: true,
        },
        {
            path: "/user-profile",
            method: "GET",
            eventHandler: new aws.lambda.CallbackFunction("get-user-profile-handler", {
                memorySize: 256, // 128, 256MB
                callback: functions.getUserProfile,
            }),
            apiKeyRequired: true,
        },
        {
            path: "/terms-and-conditions",
            target: {
                type: "http_proxy",
                uri: "https://www.google.com",
            },
        },
    ],
    apiKeySource: "AUTHORIZER",
});

// Create an API key to manage usage
const apiKey = new aws.apigateway.ApiKey("api-key");

// Define usage plan for an API stage
const usagePlan: UsagePlan = new aws.apigateway.UsagePlan("usage-plan", {
    apiStages: [{
        apiId: api.api.id,
        stage: api.stage.stageName,
        // throttles: [{ path: "/login", rateLimit:2 }, ]
    }],
    // quotaSettings: {...},
    // throttleSettings: {...},
});

// Associate the key to the plan
new aws.apigateway.UsagePlanKey("usage-plan-key", {
    keyId: apiKey.id,
    keyType: "API_KEY",
    usagePlanId: usagePlan.id,
});

// Export the url of the api
export const ApiUrl: Output<string> = api.url;


// REACT APP
import * as fs from "fs";
import * as mime from "mime";
import * as path from "path";

// contentBucket is the S3 bucket that the website's contents will be stored in.

// I had to manually allow ACL objects to be uploaded.
const contentBucket = new aws.s3.Bucket("contentBucket",
    {
        bucket: config.require("targetDomain"),
        // Configure S3 to serve bucket contents as a website. This way S3 will automatically convert
        // requests for "foo/" to "foo/index.html".
        website: {
            indexDocument: "index.html",
        },
    });

// crawlDirectory recursive crawls the provided directory, applying the provided function
// to every file it contains. Doesn't handle cycles from symlinks.
function crawlDirectory(dir: string, f: (_: string) => void) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = `${dir}/${file}`;
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            crawlDirectory(filePath, f);
        }
        if (stat.isFile()) {
            f(filePath);
        }
    }
}

// Sync the contents of the source directory with the S3 bucket, which will in-turn show up on the CDN.
const webContentsRootPath = path.join(process.cwd(), config.require("pathToWebsiteContents"));

console.log("Syncing contents from local disk at", webContentsRootPath);

crawlDirectory(
    webContentsRootPath,
    (filePath: string) => {
        const relativeFilePath = filePath.replace(webContentsRootPath + "/", "");
        const contentFile = new aws.s3.BucketObject(
            relativeFilePath,
            {
                key: relativeFilePath,
                acl: "public-read",
                bucket: contentBucket,
                contentType: mime.getType(filePath) || undefined,
                source: new pulumi.asset.FileAsset(filePath),
            },
            {
                parent: contentBucket,
            });
    });

// logsBucket is an S3 bucket that will contain the CDN's request logs.
const logsBucket = new aws.s3.Bucket("requestLogs",
    {
        bucket: `${config.require("targetDomain")}-logs`,
        acl: "private",
    });

const tenMinutes = 60 * 10;

let certificateArn: pulumi.Input<string> = config.require("certificateArn")!;

/**
 * Only provision a certificate (and related resources) if a certificateArn is _not_ provided via configuration.
 */
if (!certificateArn) {

    const eastRegion = new aws.Provider("east", {
        profile: aws.config.profile,
        region: "us-east-1", // Per AWS, ACM certificate must be in the us-east-1 region.
    });

    // if config.includeWWW include required subjectAlternativeNames to support the www subdomain
    const certificateConfig: aws.acm.CertificateArgs = {
        domainName: config.require("targetDomain"),
        validationMethod: "DNS",
        subjectAlternativeNames: config.require("includeWWW") ? [`www.${config.require("targetDomain")}`] : [],
    };

    const certificate = new aws.acm.Certificate("certificate", certificateConfig, {provider: eastRegion});

    const domainParts = getDomainAndSubdomain(config.require("targetDomain"));

    const hostedZoneId = aws.route53.getZone({name: domainParts.parentDomain}, {async: true}).then(zone => zone.zoneId);

    /**
     *  Create a DNS record to prove that we _own_ the domain we're requesting a certificate for.
     *  See https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-validate-dns.html for more info.
     */
    const certificateValidationDomain = new aws.route53.Record(`${config.require("targetDomain")}-validation`, {
        name: certificate.domainValidationOptions[0].resourceRecordName,
        zoneId: hostedZoneId,
        type: certificate.domainValidationOptions[0].resourceRecordType,
        records: [certificate.domainValidationOptions[0].resourceRecordValue],
        ttl: tenMinutes,
    });

    // if config.includeWWW ensure we validate the www subdomain as well
    let subdomainCertificateValidationDomain;
    if (config.require("includeWWW")) {
        subdomainCertificateValidationDomain = new aws.route53.Record(`${config.require("targetDomain")}-validation2`, {
            name: certificate.domainValidationOptions[1].resourceRecordName,
            zoneId: hostedZoneId,
            type: certificate.domainValidationOptions[1].resourceRecordType,
            records: [certificate.domainValidationOptions[1].resourceRecordValue],
            ttl: tenMinutes,
        });
    }

    // if config.includeWWW include the validation record for the www subdomain
    const validationRecordFqdns = subdomainCertificateValidationDomain === undefined ?
        [certificateValidationDomain.fqdn] : [certificateValidationDomain.fqdn, subdomainCertificateValidationDomain.fqdn];

    /**
     * This is a _special_ resource that waits for ACM to complete validation via the DNS record
     * checking for a status of "ISSUED" on the certificate itself. No actual resources are
     * created (or updated or deleted).
     *
     * See https://www.terraform.io/docs/providers/aws/r/acm_certificate_validation.html for slightly more detail
     * and https://github.com/terraform-providers/terraform-provider-aws/blob/master/aws/resource_aws_acm_certificate_validation.go
     * for the actual implementation.
     */
    const certificateValidation = new aws.acm.CertificateValidation("certificateValidation", {
        certificateArn: certificate.arn,
        validationRecordFqdns: validationRecordFqdns,
    }, {provider: eastRegion});

    certificateArn = certificateValidation.certificateArn;
}

// Generate Origin Access Identity to access the private s3 bucket.
const originAccessIdentity = new aws.cloudfront.OriginAccessIdentity("originAccessIdentity", {
    comment: "this is needed to setup s3 polices and make s3 not public.",
});

// if config.includeWWW include an alias for the www subdomain
const distributionAliases = config.require("includeWWW") ? [config.require("targetDomain"), `www.${config.require("targetDomain")}`] : [config.require("targetDomain")];

// distributionArgs configures the CloudFront distribution. Relevant documentation:
// https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-values-specify.html
// https://www.terraform.io/docs/providers/aws/r/cloudfront_distribution.html
const distributionArgs: aws.cloudfront.DistributionArgs = {
    enabled: true,
    // Alternate aliases the CloudFront distribution can be reached at, in addition to https://xxxx.cloudfront.net.
    // Required if you want to access the distribution via config.targetDomain as well.
    aliases: distributionAliases,

    // We only specify one origin for this distribution, the S3 content bucket.
    origins: [
        {
            originId: contentBucket.arn,
            domainName: contentBucket.bucketRegionalDomainName,
            s3OriginConfig: {
                originAccessIdentity: originAccessIdentity.cloudfrontAccessIdentityPath,
            },
        },
    ],

    defaultRootObject: "index.html",

    // A CloudFront distribution can configure different cache behaviors based on the request path.
    // Here we just specify a single, default cache behavior which is just read-only requests to S3.
    defaultCacheBehavior: {
        targetOriginId: contentBucket.arn,

        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: ["GET", "HEAD", "OPTIONS"],
        cachedMethods: ["GET", "HEAD", "OPTIONS"],

        forwardedValues: {
            cookies: {forward: "none"},
            queryString: false,
        },

        minTtl: 0,
        defaultTtl: tenMinutes,
        maxTtl: tenMinutes,
    },

    // "All" is the most broad distribution, and also the most expensive.
    // "100" is the least broad, and also the least expensive.
    priceClass: "PriceClass_100",

    // You can customize error responses. When CloudFront receives an error from the origin (e.g. S3 or some other
    // web service) it can return a different error code, and return the response for a different resource.
    customErrorResponses: [
        {errorCode: 404, responseCode: 404, responsePagePath: "/404.html"},
    ],

    restrictions: {
        geoRestriction: {
            restrictionType: "none",
        },
    },

    viewerCertificate: {
        acmCertificateArn: certificateArn,  // Per AWS, ACM certificate must be in the us-east-1 region.
        sslSupportMethod: "sni-only",
    },

    loggingConfig: {
        bucket: logsBucket.bucketDomainName,
        includeCookies: false,
        prefix: `${config.require("targetDomain")}/`,
    },
};

const cdn = new aws.cloudfront.Distribution("cdn", distributionArgs);

// Split a domain name into its subdomain and parent domain names.
// e.g. "www.example.com" => "www", "example.com".
function getDomainAndSubdomain(domain: string): { subdomain: string, parentDomain: string } {
    const parts = domain.split(".");
    if (parts.length < 2) {
        throw new Error(`No TLD found on ${domain}`);
    }
    // No subdomain, e.g. awesome-website.com.
    if (parts.length === 2) {
        return {subdomain: "", parentDomain: domain};
    }

    const subdomain = parts[0];
    parts.shift();  // Drop first element.
    return {
        subdomain,
        // Trailing "." to canonicalize domain.
        parentDomain: parts.join(".") + ".",
    };
}

// Creates a new Route53 DNS record pointing the domain to the CloudFront distribution.
function createAliasRecord(
    targetDomain: string, distribution: aws.cloudfront.Distribution): aws.route53.Record {
    const domainParts = getDomainAndSubdomain(targetDomain);
    const hostedZoneId = aws.route53.getZone({name: domainParts.parentDomain}, {async: true}).then(zone => zone.zoneId);
    return new aws.route53.Record(
        targetDomain,
        {
            name: domainParts.subdomain,
            zoneId: hostedZoneId,
            type: "A",
            aliases: [
                {
                    name: distribution.domainName,
                    zoneId: distribution.hostedZoneId,
                    evaluateTargetHealth: true,
                },
            ],
        });
}

function createWWWAliasRecord(targetDomain: string, distribution: aws.cloudfront.Distribution): aws.route53.Record {
    const domainParts = getDomainAndSubdomain(targetDomain);
    const hostedZoneId = aws.route53.getZone({name: domainParts.parentDomain}, {async: true}).then(zone => zone.zoneId);

    return new aws.route53.Record(
        `${targetDomain}-www-alias`,
        {
            name: `www.${targetDomain}`,
            zoneId: hostedZoneId,
            type: "A",
            aliases: [
                {
                    name: distribution.domainName,
                    zoneId: distribution.hostedZoneId,
                    evaluateTargetHealth: true,
                },
            ],
        },
    );
}



const bucketPolicy = new aws.s3.BucketPolicy("bucketPolicy", {
    bucket: contentBucket.id, // refer to the bucket created earlier
    policy: pulumi.jsonStringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Principal: {
                        AWS: originAccessIdentity.iamArn,
                    }, // Only allow Cloudfront read access.
                    Action: [
                        "s3:GetObject",
                        "s3:ListBucket",
                        "s3:PutObject",
                        "s3:PutObjectAcl",
                        "s3:ReplicateObject",
                        "s3:DeleteObject"
                    ],
                    Resource: [pulumi.interpolate`${contentBucket.arn}/*`], // Give Cloudfront access to the entire bucket.
                },
            ],
        },
    )
});

const aRecord = createAliasRecord(config.require("targetDomain"), cdn);

if (config.require("includeWWW")) {
    const cnameRecord = createWWWAliasRecord(config.require("targetDomain"), cdn);
}

// Export properties from this stack. This prints them at the end of `pulumi up` and
// makes them easier to access from pulumi.com.
export const contentBucketUri = pulumi.interpolate`s3://${contentBucket.bucket}`;
export const contentBucketWebsiteEndpoint = contentBucket.websiteEndpoint;
export const cloudFrontDomain = cdn.domainName;
export const targetDomainEndpoint = `https://${config.require("targetDomain")}/`;
export const asd = originAccessIdentity.iamArn;
export const aa = contentBucket.arn;