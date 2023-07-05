import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config();
const stack = pulumi.getStack();

const apiDb = new aws.rds.Instance(`${stack}`, {
    allocatedStorage: 10,
    dbName: `${stack}`,
    engine: "mysql",
    engineVersion: "5.7",
    instanceClass: "db.t3.micro",
    parameterGroupName: "default.mysql5.7",
    password: "17263787888",
    skipFinalSnapshot: true,
    username: "superuser",
});

export const ApiDbInstance = apiDb;