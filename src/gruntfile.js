module.exports = function (grunt) {
    grunt.initConfig({
        exec: {
            tsc: {
                command: "tsc -p tsconfig.json",
                stdout: true,
                stderr: true
            },
            package_dev: {
                command: "tfx extension create --rev-version --manifests vss-extension.json --overrides-file configs/dev.json --output-path ../dist" ,
                stdout: true,
                stderr: true
            },
            package_release: {
                command: "tfx extension create  --manifests vss-extension.json --overrides-file configs/release.json --output-path ../dist",
                stdout: true,
                stderr: true
            },
            publish_dev: {
                command: "tfx extension publish --service-url https://marketplace.visualstudio.com --manifests vss-extension.json --overrides-file configs/dev.json --output-path ../dist",
                stdout: true,
                stderr: true
            },
            publish_release: {
                command: "tfx extension publish --service-url https://marketplace.visualstudio.com --manifests vss-extension.json --overrides-file configs/release.json --output-path ../dist",
                stdout: true,
                stderr: true
            },
            serve: {
                command: "http-server . -S -C certs/cert.pem -K certs/key.pem -p 5501 -a localhost -c-1",
                stdout: true,
                stderr: true
            }
        },
        copy: {
            scripts: {
                files: [{
                    expand: true, 
                    flatten: true, 
                    src: ["node_modules/vss-web-extension-sdk/lib/VSS.SDK.min.js"], 
                    dest: "lib",
                    filter: "isFile" 
                }]
            }
        },

        clean: ["../dist/*.vsix"],

        
    });
    
    grunt.loadNpmTasks("grunt-exec");
    grunt.loadNpmTasks("grunt-contrib-copy");
    grunt.loadNpmTasks('grunt-contrib-clean');

    grunt.registerTask("package-dev", ["exec:tsc", "exec:package_dev"]);
    grunt.registerTask("package-release", ["exec:tsc", "exec:package_release"]);
    grunt.registerTask("publish-dev", ["package-dev", "exec:publish_dev"]);        
    grunt.registerTask("publish-release", ["package-release", "exec:publish_release"]);        
    grunt.registerTask("serve", ["exec:tsc", "exec:serve"]);
    
    grunt.registerTask("default", ["package-dev"]);
};